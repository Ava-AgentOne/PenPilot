/**
 * PenPilot projects: the whole page in one ".penpilot" file -- every drawing
 * with its lines, place, size, fill and pen, photos with their pictures, the
 * paper and the pens used -- so it can be opened again exactly as it was.
 * Also the page as an SVG drawing, one layer per pen.
 *
 * The file is JSON. Lines are kept as they are (not redrawn on opening), so a
 * photo style with random parts, or a font, comes back identical.
 */

import type { Path } from "flatten-svg";
import type { FillInfo } from "./hatch.js";
import { itemDrawnPaths, itemPointToPage, newItemId, type PageItem, type Rotation, type Size } from "./page.js";
import type { Pen } from "./pens.js";
import { penName } from "./pens.js";
import type { PhotoConfig, PhotoControl } from "./photo.js";
import type { ShapeInfo } from "./shapes.js";
import type { TextInfo } from "./text.js";

export const PROJECT_EXTENSION = "penpilot";
const FORMAT = "penpilot-project";
const VERSION = 1;

interface SavedPath {
  /** Stroke colour, group, and the points as x, y, x, y, ... */
  s: string;
  g: string;
  p: number[];
}

interface SavedPhoto {
  /** The picture as a data: URL. */
  image: string;
  style: string;
  detail: number;
  width: number;
  height: number;
  controls: PhotoControl[];
  config: PhotoConfig;
}

interface SavedItem {
  id: string;
  name: string;
  paths: SavedPath[];
  bounds: PageItem["bounds"];
  x: number;
  y: number;
  scale: number;
  rotation: Rotation;
  penId?: string;
  fill?: FillInfo;
  text?: TextInfo;
  shape?: ShapeInfo;
  photo?: SavedPhoto;
  svgText?: string;
  fillOnly?: boolean;
  skip?: boolean;
}

export interface Project {
  paper: { width: number; height: number; margin: number };
  pens: Pen[];
  items: PageItem[];
}

const round = (n: number) => Math.round(n * 1000) / 1000;

async function urlToDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("PenPilot couldn't read a picture to save it."));
    reader.readAsDataURL(blob);
  });
}

/** The project as the text of a .penpilot file. */
export async function projectToText(project: Project, appVersion: string): Promise<string> {
  const items: SavedItem[] = [];
  for (const it of project.items) {
    const saved: SavedItem = {
      id: it.id,
      name: it.name,
      paths: it.paths.map((p) => ({ s: p.stroke, g: p.groupId, p: p.points.flatMap((q) => [round(q.x), round(q.y)]) })),
      bounds: it.bounds,
      x: it.x,
      y: it.y,
      scale: it.scale,
      rotation: it.rotation,
      penId: it.penId,
      fill: it.fill,
      shape: it.shape,
      svgText: it.svgText,
      fillOnly: it.fillOnly,
      skip: it.skip,
    };
    if (it.text) {
      const { error: _error, ...text } = it.text;
      saved.text = text as TextInfo;
    }
    if (it.photo) {
      const ph = it.photo;
      saved.photo = {
        image: await urlToDataUrl(ph.previewUrl),
        style: ph.style,
        detail: ph.detail,
        width: ph.width,
        height: ph.height,
        controls: ph.controls,
        config: ph.config,
      };
    }
    items.push(saved);
  }
  return JSON.stringify({
    format: FORMAT,
    version: VERSION,
    app: appVersion,
    paper: project.paper,
    pens: project.pens,
    items,
  });
}

class ProjectError extends Error {}

const num = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ProjectError(`This project file is damaged (${what}).`);
  return v;
};

/** A damaged or tampered file can't make PenPilot draw millions of points or freeze it. */
const MAX_POINTS = 5_000_000;
let pointsRead = 0;

function readPaths(raw: unknown): Path[] {
  if (!Array.isArray(raw)) throw new ProjectError("This project file is damaged (lines).");
  return raw.map((p: SavedPath) => {
    const flat = Array.isArray(p?.p) ? p.p : [];
    pointsRead += flat.length / 2;
    if (pointsRead > MAX_POINTS) throw new ProjectError("This project is too large to open.");
    const points = [];
    for (let i = 0; i + 1 < flat.length; i += 2)
      points.push({ x: num(flat[i], "points"), y: num(flat[i + 1], "points") });
    return { stroke: typeof p?.s === "string" ? p.s : "", groupId: typeof p?.g === "string" ? p.g : "", points };
  });
}

// Settings read from a file are kept within what the app itself allows, so a
// damaged file can't ask for, say, a shape kilometres wide or a fill line every
// thousandth of a millimetre (either would freeze PenPilot).
const clamp = (v: unknown, lo: number, hi: number, dflt: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;

function readFill(raw: FillInfo): FillInfo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const kind = (["none", "lines", "cross", "concentric"] as const).find((k) => k === raw.kind) ?? "none";
  return {
    kind,
    spacingMm: clamp(raw.spacingMm, 0.1, 50, 0.5),
    angle: clamp(raw.angle, -360, 360, 45),
    outline: raw.outline !== false,
  };
}

function readShape(raw: ShapeInfo): ShapeInfo | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const w = clamp(raw.w, 3, 2000, 50);
  const h = clamp(raw.h, 3, 2000, 50);
  return {
    kind: raw.kind === "ellipse" ? "ellipse" : "rect",
    w,
    h,
    radius: clamp(raw.radius, 0, Math.min(w, h) / 2, 0),
    lines: Math.round(clamp(raw.lines, 1, 10, 1)),
    gap: clamp(raw.gap, 0.1, 100, 2),
  };
}

function readText(raw: TextInfo): TextInfo | undefined {
  if (!raw || typeof raw !== "object" || typeof raw.text !== "string" || typeof raw.font !== "string") return undefined;
  return {
    text: raw.text.slice(0, 5000),
    font: raw.font,
    sizeMm: clamp(raw.sizeMm, 1, 500, 10),
    letterSpacing: clamp(raw.letterSpacing, -1, 5, 0),
    lineSpacing: clamp(raw.lineSpacing, 0.3, 5, 1),
    align: raw.align === "centre" || raw.align === "right" ? raw.align : "left",
    style: raw.style === "filled" ? "filled" : raw.style === "line" ? "line" : undefined,
  };
}

async function readPhoto(raw: SavedPhoto): Promise<PageItem["photo"]> {
  if (typeof raw.image !== "string" || !raw.image.startsWith("data:image/")) {
    throw new ProjectError("A picture in this project file is missing.");
  }
  const blob = await (await fetch(raw.image)).blob();
  const bitmap = await createImageBitmap(blob);
  return {
    bitmap,
    previewUrl: URL.createObjectURL(blob),
    style: String(raw.style),
    detail: clamp(num(raw.detail, "photo detail"), 50, 4000, 800),
    width: clamp(num(raw.width, "photo size"), 1, 10000, 800),
    height: clamp(num(raw.height, "photo size"), 1, 10000, 800),
    controls: Array.isArray(raw.controls) ? raw.controls : [],
    config: raw.config && typeof raw.config === "object" ? raw.config : {},
    status: "done",
    message: "",
  };
}

/**
 * Read a .penpilot file. Items get fresh ids and are marked as opened, so
 * their saved lines are used as they are. Throws an Error with a plain message.
 */
export async function projectFromText(text: string): Promise<Project> {
  let raw: {
    format?: string;
    version?: number;
    paper?: Project["paper"];
    pens?: Pen[];
    items?: SavedItem[];
  };
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectError("This isn't a PenPilot project file.");
  }
  if (raw?.format !== FORMAT || !Array.isArray(raw.items))
    throw new ProjectError("This isn't a PenPilot project file.");
  if (typeof raw.version !== "number" || raw.version > VERSION) {
    throw new ProjectError("This project was saved by a newer PenPilot. Update PenPilot to open it.");
  }
  const width = clamp(num(raw.paper?.width, "paper"), 10, 2000, 297);
  const height = clamp(num(raw.paper?.height, "paper"), 10, 2000, 210);
  const paper = { width, height, margin: clamp(num(raw.paper?.margin, "paper"), 0, Math.min(width, height) / 2, 20) };
  pointsRead = 0;
  const items: PageItem[] = [];
  for (const it of raw.items) {
    const rotation = ([0, 90, 180, 270] as const).find((r) => r === it.rotation) ?? 0;
    const b = it.bounds ?? { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    const item: PageItem = {
      id: newItemId(),
      name: typeof it.name === "string" ? it.name : "Drawing",
      paths: readPaths(it.paths),
      bounds: {
        minX: num(b.minX, "size"),
        minY: num(b.minY, "size"),
        maxX: num(b.maxX, "size"),
        maxY: num(b.maxY, "size"),
      },
      x: num(it.x, "position"),
      y: num(it.y, "position"),
      scale: clamp(num(it.scale, "size"), 1e-6, 1e6, 1),
      rotation,
      restored: true,
    };
    if (typeof it.penId === "string") item.penId = it.penId;
    const fill = readFill(it.fill as FillInfo);
    if (fill) item.fill = fill;
    const text = readText(it.text as TextInfo);
    if (text) item.text = text;
    const shape = readShape(it.shape as ShapeInfo);
    if (shape) item.shape = shape;
    if (typeof it.svgText === "string") item.svgText = it.svgText;
    if (it.fillOnly) item.fillOnly = true;
    if (it.skip) item.skip = true;
    if (it.photo) item.photo = await readPhoto(it.photo);
    items.push(item);
  }
  const pens = Array.isArray(raw.pens) ? raw.pens.filter((p) => p && typeof p.id === "string") : [];
  return { paper, pens, items };
}

// ---- SVG export --------------------------------------------------------------------

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c] ?? c);
const fmt = (n: number) => String(round(n));

/**
 * The page as an SVG drawing in mm, exactly what PenPilot would plot (fills
 * included): one layer per pen, in plotting order, in that pen's colour and
 * line width. Inkscape shows the layers by pen name.
 */
export function pageToSvg(items: PageItem[], pageSize: Size, pens: Pen[], penOf: (item: PageItem) => Pen): string {
  const layers: string[] = [];
  pens.forEach((pen, n) => {
    const mine = items.filter((it) => penOf(it).id === pen.id && it.paths.length > 0);
    if (mine.length === 0) return;
    const body = mine.map((it) => {
      let d = "";
      for (const path of itemDrawnPaths(it).paths) {
        path.points.forEach((q, i) => {
          const p = itemPointToPage(it, q);
          d += `${i === 0 ? "M" : "L"}${fmt(p.x)} ${fmt(p.y)}`;
        });
      }
      return `    <path inkscape:label="${esc(it.name)}" d="${d}"/>`;
    });
    layers.push(
      `  <g id="pen-${n + 1}" inkscape:groupmode="layer" inkscape:label="${n + 1} ${esc(penName(pen))}" ` +
        `fill="none" stroke="${esc(pen.colour)}" stroke-width="${fmt(pen.widthMm)}" ` +
        `stroke-linecap="round" stroke-linejoin="round">\n${body.join("\n")}\n  </g>`,
    );
  });
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ` +
    `width="${fmt(pageSize.x)}mm" height="${fmt(pageSize.y)}mm" viewBox="0 0 ${fmt(pageSize.x)} ${fmt(pageSize.y)}">\n` +
    `${layers.join("\n")}\n</svg>\n`
  );
}

/** A file name from a drawing or project name. */
export function fileBaseName(name: string): string {
  const base = name
    .replace(/\.(penpilot|svg)$/i, "")
    .replace(/[“”"\\/:*?<>|]+/g, "")
    .trim();
  return base.slice(0, 60) || "My page";
}
