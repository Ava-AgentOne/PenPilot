/**
 * PenPilot's page: several drawings ("items") placed on one sheet of paper,
 * each with its own position, size and quarter-turn rotation.
 *
 * Coordinates:
 * - source units: what flatten-svg returns (CSS px, 96 per inch)
 * - page mm: the sheet as the user designs it (portrait or landscape),
 *   origin at its top-left corner
 * - machine mm: the AxiDraw's own axes, origin at the pen's home corner.
 *   A page that doesn't fit the machine as shown (e.g. A4 portrait, 297 mm
 *   tall, on a V3 that reaches 218 mm in Y) is plotted turned sideways.
 */

import type { Path } from "flatten-svg";
import type { Vec2 } from "../vec.js";

export const MM_PER_SOURCE_UNIT = 25.4 / 96;

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type Rotation = 0 | 90 | 180 | 270;

export interface PageItem {
  id: string;
  name: string;
  /** Lines in source units, with their stroke colour and group, as read from the file. */
  paths: Path[];
  /** Bounds of `paths`, source units. */
  bounds: Bounds;
  /** Top-left corner of the item's (rotated) box on the page, mm. */
  x: number;
  y: number;
  /** mm per source unit. */
  scale: number;
  /** Clockwise quarter turns. */
  rotation: Rotation;
}

export interface Page {
  items: PageItem[];
  selectedId: string | null;
}

export const emptyPage: Page = { items: [], selectedId: null };

export interface Size {
  x: number;
  y: number;
}

// ---- Geometry ----------------------------------------------------------------

export function boundsOf(paths: Path[]): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const path of paths) {
    for (const p of path.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/** The item's unrotated size, mm. */
function sourceSizeMm(item: PageItem): Size {
  return {
    x: (item.bounds.maxX - item.bounds.minX) * item.scale,
    y: (item.bounds.maxY - item.bounds.minY) * item.scale,
  };
}

/** The item's box on the page (after rotation), mm. */
export function itemSize(item: PageItem): Size {
  const s = sourceSizeMm(item);
  return item.rotation === 90 || item.rotation === 270 ? { x: s.y, y: s.x } : s;
}

/** Maps a point of the item (source units) onto the page (mm). */
export function itemPointToPage(item: PageItem, p: Vec2): Vec2 {
  const { x: w, y: h } = sourceSizeMm(item);
  const lx = (p.x - item.bounds.minX) * item.scale;
  const ly = (p.y - item.bounds.minY) * item.scale;
  let r: Vec2;
  switch (item.rotation) {
    case 90:
      r = { x: h - ly, y: lx };
      break;
    case 180:
      r = { x: w - lx, y: h - ly };
      break;
    case 270:
      r = { x: ly, y: w - lx };
      break;
    default:
      r = { x: lx, y: ly };
  }
  return { x: r.x + item.x, y: r.y + item.y };
}

/** SVG transform drawing the item's source paths at its place on the page (mm). */
export function itemSvgTransform(item: PageItem): string {
  const { x: w, y: h } = sourceSizeMm(item);
  const placeAndTurn = {
    0: `translate(${item.x} ${item.y})`,
    90: `translate(${item.x + h} ${item.y}) rotate(90)`,
    180: `translate(${item.x + w} ${item.y + h}) rotate(180)`,
    270: `translate(${item.x} ${item.y + w}) rotate(270)`,
  }[item.rotation];
  return `${placeAndTurn} scale(${item.scale}) translate(${-item.bounds.minX} ${-item.bounds.minY})`;
}

// ---- Page <-> machine -------------------------------------------------------------

export type Placement = "as-shown" | "sideways";

/** How far the plotter's pen can travel from its home corner, mm. */
export function machineReach(hardware: string): Size | null {
  // AxiDraw V3 (standard or brushless pen-lift): 11.81 x 8.58 in.
  if (hardware === "v3" || hardware === "brushless") return { x: 300, y: 218 };
  return null;
}

/**
 * Plot the page as shown when it fits the machine; otherwise turn it so its
 * long side runs along the machine's long (X) axis.
 */
export function choosePlacement(page: Size, reach: Size | null): Placement {
  if (!reach) return "as-shown";
  const eps = 0.01;
  if (page.x <= reach.x + eps && page.y <= reach.y + eps) return "as-shown";
  if (page.y <= reach.x + eps && page.x <= reach.y + eps) return "sideways";
  return page.x >= page.y ? "as-shown" : "sideways";
}

/**
 * Sideways: the page is turned so that its top edge lies along the machine's
 * left edge and its top-right corner sits at the pen's home corner.
 */
export function pageToMachine(p: Vec2, placement: Placement, page: Size): Vec2 {
  return placement === "sideways" ? { x: p.y, y: page.x - p.x } : p;
}

export function machineToPage(m: Vec2, placement: Placement, page: Size): Vec2 {
  return placement === "sideways" ? { x: page.x - m.y, y: m.x } : m;
}

/** The sheet as it lies in the plotter, mm. */
export function machinePaper(placement: Placement, page: Size): Size {
  return placement === "sideways" ? { x: page.y, y: page.x } : page;
}

/** Area that can actually be drawn: the sheet, limited to the machine's reach (machine mm). */
export function drawableArea(placement: Placement, page: Size, reach: Size | null): Size {
  const paper = machinePaper(placement, page);
  return reach ? { x: Math.min(paper.x, reach.x), y: Math.min(paper.y, reach.y) } : paper;
}

/**
 * All items' lines in machine coordinates, in source units (what saxi's
 * planner expects with fitPage off). Each item becomes its own layer group.
 */
export function plannerPaths(page: Page, placement: Placement, pageSize: Size): Path[] {
  const out: Path[] = [];
  const names = new Map<string, number>();
  for (const item of page.items) {
    const seen = names.get(item.name) ?? 0;
    names.set(item.name, seen + 1);
    const groupId = seen === 0 ? item.name : `${item.name} (${seen + 1})`;
    for (const path of item.paths) {
      out.push({
        stroke: path.stroke,
        groupId,
        points: path.points.map((p) => {
          const m = pageToMachine(itemPointToPage(item, p), placement, pageSize);
          return { x: m.x / MM_PER_SOURCE_UNIT, y: m.y / MM_PER_SOURCE_UNIT };
        }),
      });
    }
  }
  return out;
}

/** Bounding box of everything that will be drawn, machine mm, clipped to the drawable area. */
export function drawingBoxOnMachine(page: Page, placement: Placement, pageSize: Size, drawable: Size): Bounds | null {
  let box: Bounds | null = null;
  for (const item of page.items) {
    const { x: w, y: h } = itemSize(item);
    for (const corner of [
      { x: item.x, y: item.y },
      { x: item.x + w, y: item.y + h },
    ]) {
      const m = pageToMachine(corner, placement, pageSize);
      box = box
        ? {
            minX: Math.min(box.minX, m.x),
            minY: Math.min(box.minY, m.y),
            maxX: Math.max(box.maxX, m.x),
            maxY: Math.max(box.maxY, m.y),
          }
        : { minX: m.x, minY: m.y, maxX: m.x, maxY: m.y };
    }
  }
  if (!box) return null;
  const clipped = {
    minX: Math.max(0, box.minX),
    minY: Math.max(0, box.minY),
    maxX: Math.min(drawable.x, box.maxX),
    maxY: Math.min(drawable.y, box.maxY),
  };
  return clipped.maxX > clipped.minX && clipped.maxY > clipped.minY ? clipped : null;
}

/** Whether part of an item lies outside the area that can be drawn (page mm). */
export function itemOverflows(item: PageItem, drawableOnPage: Bounds): boolean {
  const { x: w, y: h } = itemSize(item);
  const eps = 0.01;
  return (
    item.x < drawableOnPage.minX - eps ||
    item.y < drawableOnPage.minY - eps ||
    item.x + w > drawableOnPage.maxX + eps ||
    item.y + h > drawableOnPage.maxY + eps
  );
}

/** The drawable area, expressed on the page (page mm). */
export function drawableOnPage(placement: Placement, pageSize: Size, drawable: Size): Bounds {
  const a = machineToPage({ x: 0, y: 0 }, placement, pageSize);
  const b = machineToPage(drawable, placement, pageSize);
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

// ---- Placing items ------------------------------------------------------------

/** Scale and centre an item so it fits inside the page's margins. */
export function fitItem(item: PageItem, pageSize: Size, marginMm: number): PageItem {
  const avail = { x: Math.max(1, pageSize.x - 2 * marginMm), y: Math.max(1, pageSize.y - 2 * marginMm) };
  const unscaled = itemSize({ ...item, scale: 1 });
  const scale = Math.min(avail.x / Math.max(unscaled.x, 1e-9), avail.y / Math.max(unscaled.y, 1e-9));
  return centreItem({ ...item, scale }, pageSize);
}

export function centreItem(item: PageItem, pageSize: Size): PageItem {
  const { x: w, y: h } = itemSize(item);
  return { ...item, x: (pageSize.x - w) / 2, y: (pageSize.y - h) / 2 };
}

/** Turn an item a quarter turn clockwise, keeping its centre in place. */
export function rotateItem(item: PageItem): PageItem {
  const before = itemSize(item);
  const rotation = ((item.rotation + 90) % 360) as Rotation;
  const turned = { ...item, rotation };
  const after = itemSize(turned);
  return { ...turned, x: item.x + (before.x - after.x) / 2, y: item.y + (before.y - after.y) / 2 };
}

let nextId = 1;

/**
 * A new item at its natural size (the size written in the SVG), centred,
 * or shrunk to fit inside the margins if it's bigger.
 */
export function newItem(name: string, paths: Path[], pageSize: Size, marginMm: number): PageItem | null {
  const bounds = boundsOf(paths);
  if (!bounds) return null;
  const item: PageItem = {
    id: `item-${Date.now()}-${nextId++}`,
    name,
    paths,
    bounds,
    x: 0,
    y: 0,
    scale: MM_PER_SOURCE_UNIT,
    rotation: 0,
  };
  const natural = itemSize(item);
  const fitsNaturally = natural.x <= pageSize.x - 2 * marginMm && natural.y <= pageSize.y - 2 * marginMm;
  return fitsNaturally ? centreItem(item, pageSize) : fitItem(item, pageSize, marginMm);
}

// ---- State -----------------------------------------------------------------------

export type PageAction =
  | { type: "add"; items: PageItem[] }
  | { type: "update"; item: PageItem }
  /** Move by an offset, based on the current state (safe for key repeat). */
  | { type: "nudge"; id: string; dx: number; dy: number }
  | { type: "remove"; id: string }
  | { type: "select"; id: string | null }
  | { type: "clear" };

export function pageReducer(page: Page, action: PageAction): Page {
  switch (action.type) {
    case "add":
      if (action.items.length === 0) return page;
      return { items: [...page.items, ...action.items], selectedId: action.items[action.items.length - 1].id };
    case "update":
      return { ...page, items: page.items.map((it) => (it.id === action.item.id ? action.item : it)) };
    case "nudge":
      return {
        ...page,
        items: page.items.map((it) => (it.id === action.id ? { ...it, x: it.x + action.dx, y: it.y + action.dy } : it)),
      };
    case "remove": {
      const items = page.items.filter((it) => it.id !== action.id);
      return { items, selectedId: page.selectedId === action.id ? null : page.selectedId };
    }
    case "select":
      return { ...page, selectedId: action.id };
    case "clear":
      return emptyPage;
  }
}
