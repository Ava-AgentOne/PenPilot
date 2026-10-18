/**
 * PenPilot's simple shapes: rectangles (optionally with rounded corners),
 * circles and ellipses, and a border round the page. A shape can be drawn
 * with several lines, each inside the last; any of them can be hatch-filled.
 *
 * A shape's lines are in mm, with the item at scale 1: resizing changes the
 * shape itself (width and height separately), so corners and gaps keep their size.
 */

import type { Path } from "flatten-svg";
import type { Vec2 } from "../vec.js";

export type ShapeKind = "rect" | "ellipse";

export interface ShapeInfo {
  kind: ShapeKind;
  /** Outer size, mm. */
  w: number;
  h: number;
  /** Corner radius of a rectangle, mm. */
  radius: number;
  /** How many lines, each `gap` mm inside the last (a double border is 2). */
  lines: number;
  gap: number;
}

export const MAX_SHAPE_LINES = 10;
const STROKE = "#000000";

/** Points round an ellipse arc from angle a0 to a1 (radians), no more than ~0.5 mm apart. */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): Vec2[] {
  const steps = Math.max(4, Math.ceil((Math.abs(a1 - a0) * Math.max(rx, ry)) / 0.5));
  const out: Vec2[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push({ x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  return out;
}

/** One closed outline at (x, y), size w × h. */
function outline(kind: ShapeKind, x: number, y: number, w: number, h: number, radius: number): Vec2[] {
  if (kind === "ellipse") {
    const pts = arc(x + w / 2, y + h / 2, w / 2, h / 2, -Math.PI / 2, (3 * Math.PI) / 2);
    pts[pts.length - 1] = { ...pts[0] }; // exactly closed
    return pts;
  }
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r < 0.01) {
    return [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
      { x, y },
    ];
  }
  const h2 = Math.PI / 2;
  const pts = [
    ...arc(x + w - r, y + r, r, r, -h2, 0),
    ...arc(x + w - r, y + h - r, r, r, 0, h2),
    ...arc(x + r, y + h - r, r, r, h2, Math.PI),
    ...arc(x + r, y + r, r, r, Math.PI, Math.PI + h2),
  ];
  pts.push({ ...pts[0] });
  return pts;
}

/** The shape's lines, mm, its box from (0, 0) to (w, h). */
export function shapePaths(s: ShapeInfo): Path[] {
  const out: Path[] = [];
  const lines = Math.max(1, Math.min(MAX_SHAPE_LINES, Math.round(s.lines)));
  for (let i = 0; i < lines; i++) {
    const inset = i * Math.max(0, s.gap);
    const w = s.w - 2 * inset;
    const h = s.h - 2 * inset;
    if (w <= 0.05 || h <= 0.05) break; // the lines have met in the middle
    out.push({ stroke: STROKE, groupId: "", points: outline(s.kind, inset, inset, w, h, s.radius - inset) });
  }
  return out;
}

export const SHAPE_NAMES: Record<"rect" | "ellipse" | "border", string> = {
  rect: "Rectangle",
  ellipse: "Circle",
  border: "Border",
};
