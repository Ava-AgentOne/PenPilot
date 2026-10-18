/**
 * PenPilot's hatch fill: make closed shapes look solid with pen lines.
 * - lines: parallel lines at an angle
 * - cross: two sets of lines at right angles
 * - concentric: shrinking copies of the outline (Clipper, clipper-lib, BSL-1.0)
 * Shapes are filled with the even-odd rule, so holes (the inside of an "O",
 * the eyes of a traced face) stay empty.
 */

import ClipperLib from "clipper-lib";
import type { Vec2 } from "../vec.js";

export type FillKind = "none" | "lines" | "cross" | "concentric";

export interface FillInfo {
  kind: FillKind;
  /** Distance between fill lines, mm (a pen's line width makes it look solid). */
  spacingMm: number;
  /** Direction of the lines, degrees on the page (0 = horizontal). */
  angle: number;
  /** Keep drawing the shapes' outlines too. */
  outline: boolean;
}

export const defaultFill = (): FillInfo => ({ kind: "lines", spacingMm: 0.5, angle: 45, outline: true });

/** Closed shapes among some lines: those that end where they started. */
export function closedRings(lines: Vec2[][], tol: number): Vec2[][] {
  return lines.filter((l) => {
    if (l.length < 4) return false;
    const a = l[0];
    const b = l[l.length - 1];
    return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol;
  });
}

const rotate = (p: Vec2, c: number, s: number): Vec2 => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c });

/**
 * Parallel lines `spacing` apart at `angleDeg`, inside the rings (even-odd).
 * Lines in neighbouring rows are joined into zig-zags where the step from one
 * to the next runs along the shape's edge (and stays inside it), so the pen
 * stays down through a whole letter instead of lifting at every line.
 */
export function hatchLines(rings: Vec2[][], spacing: number, angleDeg: number): Vec2[][] {
  if (rings.length === 0 || spacing <= 0) return [];
  const t = (angleDeg * Math.PI) / 180;
  const [c, s] = [Math.cos(-t), Math.sin(-t)];
  const flat = rings.map((r) => r.map((p) => rotate(p, c, s)));
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const r of flat) {
    for (const p of r) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  const n = Math.floor((maxY - minY) / spacing);
  if (n > 200000) return []; // absurdly fine spacing for this size
  const offset = minY + (maxY - minY - n * spacing) / 2; // centre the lines in the shape
  // Where the edges cross every row (y = offset + k*spacing) and every half
  // row between them (to check the zig-zag steps), bucketed per row:
  // O(edges + crossings). Each full-row crossing also notes its place along
  // its ring's outline, so a step can tell it follows the outline.
  type Hit = { x: number; ring: number; pos: number };
  const half = spacing / 2;
  const hits: Hit[][] = Array.from({ length: 2 * n + 1 }, () => []);
  const ringHits: number[] = [];
  flat.forEach((r, ring) => {
    let pos = 0;
    for (let i = 0; i + 1 < r.length; i++) {
      const a = r[i];
      const b = r[i + 1];
      if (a.y === b.y) continue;
      const [lo, hi] = a.y < b.y ? [a, b] : [b, a];
      const k0 = Math.max(0, Math.ceil((lo.y - offset) / half));
      const k1 = Math.min(2 * n, Math.ceil((hi.y - offset) / half) - 1);
      // In the edge's own direction, so `pos` runs along the outline.
      for (let j = 0; j <= k1 - k0; j++) {
        const k = a.y < b.y ? k0 + j : k1 - j;
        const y = offset + k * half;
        if (y < lo.y || y >= hi.y) continue;
        const x = lo.x + ((y - lo.y) * (hi.x - lo.x)) / (hi.y - lo.y);
        hits[k].push({ x, ring, pos: k % 2 === 0 ? pos++ : -1 });
      }
    }
    ringHits.push(pos);
  });
  for (const row of hits) row.sort((p, q) => p.x - q.x);
  // Each row's pieces inside the shape: pairs of crossings (even-odd).
  const rows: [Hit, Hit][][] = [];
  for (let k = 0; k <= n; k++) {
    const row = hits[2 * k];
    const segs: [Hit, Hit][] = [];
    for (let i = 0; i + 1 < row.length; i += 2) if (row[i + 1].x - row[i].x > 1e-9) segs.push([row[i], row[i + 1]]);
    rows.push(segs);
  }
  // A zig-zag step from one row to the next follows the outline: its two ends
  // are neighbouring crossings along the same ring, and its middle is inside
  // the shape (not across a dent). Within a hair of the edge counts as inside.
  const followsOutline = (h: number, p: Hit, q: Hit) => {
    if (p.ring !== q.ring) return false;
    const d = (((q.pos - p.pos) % ringHits[p.ring]) + ringHits[p.ring]) % ringHits[p.ring];
    if (d !== 1 && d !== ringHits[p.ring] - 1) return false;
    const x = (p.x + q.x) / 2;
    let count = 0;
    for (const v of hits[2 * h + 1]) {
      if (Math.abs(v.x - x) < 0.05 * spacing) return true;
      if (v.x < x) count++;
    }
    return count % 2 === 1;
  };
  const maxStep = 4 * spacing; // sideways reach of a zig-zag step
  const used = rows.map((segs) => segs.map(() => false));
  const [cb, sb] = [Math.cos(t), Math.sin(t)];
  const back = (x: number, k: number) => rotate({ x, y: offset + k * spacing }, cb, sb);
  const out: Vec2[][] = [];
  for (let k0 = 0; k0 <= n; k0++) {
    for (let i0 = 0; i0 < rows[k0].length; i0++) {
      if (used[k0][i0]) continue;
      used[k0][i0] = true;
      // Draw this piece left to right, then zig-zag down the rows.
      let [from, to] = rows[k0][i0];
      const chain = [back(from.x, k0), back(to.x, k0)];
      for (let k = k0; k < n; k++) {
        const segs = rows[k + 1];
        let next = -1;
        for (let j = 0; j < segs.length; j++) {
          if (used[k + 1][j]) continue;
          // The next piece starts at its end on the same side as we finished.
          const start = to.x > from.x ? segs[j][1] : segs[j][0];
          if (Math.abs(start.x - to.x) <= maxStep && followsOutline(k, to, start)) {
            next = j;
            break;
          }
        }
        if (next < 0) break;
        used[k + 1][next] = true;
        [from, to] = to.x > from.x ? [segs[next][1], segs[next][0]] : segs[next];
        chain.push(back(from.x, k + 1), back(to.x, k + 1));
      }
      out.push(chain);
    }
  }
  return out;
}

/** Shrinking copies of the outline, `spacing` apart, until nothing is left. */
export function concentricRings(rings: Vec2[][], spacing: number, maxRounds = 2000): Vec2[][] {
  if (rings.length === 0 || spacing <= 0) return [];
  const scale = 100 / spacing; // Clipper works in integers: 100 units per spacing
  const input = rings.map((r) => r.map((q) => ({ X: Math.round(q.x * scale), Y: Math.round(q.y * scale) })));
  // Tidy the input into proper outer shapes and holes (even-odd).
  const c = new ClipperLib.Clipper();
  c.AddPaths(input, ClipperLib.PolyType.ptSubject, true);
  let current: { X: number; Y: number }[][] = new ClipperLib.Paths();
  c.Execute(
    ClipperLib.ClipType.ctUnion,
    current,
    ClipperLib.PolyFillType.pftEvenOdd,
    ClipperLib.PolyFillType.pftEvenOdd,
  );
  const out: Vec2[][] = [];
  for (let round = 0; round < maxRounds && current.length > 0; round++) {
    const co = new ClipperLib.ClipperOffset(2, 0.25);
    co.AddPaths(current, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
    const next: { X: number; Y: number }[][] = new ClipperLib.Paths();
    co.Execute(next, -100);
    current = next;
    for (const p of current) {
      if (p.length < 3) continue;
      const loop = p.map((q) => ({ x: q.X / scale, y: q.Y / scale }));
      loop.push({ ...loop[0] });
      out.push(loop);
    }
  }
  return out;
}

/** The fill lines for some closed shapes (in their own units; `spacing` in the same units). */
export function fillShapes(rings: Vec2[][], kind: FillKind, spacing: number, angleDeg: number): Vec2[][] {
  switch (kind) {
    case "lines":
      return hatchLines(rings, spacing, angleDeg);
    case "cross":
      return hatchLines(rings, spacing, angleDeg).concat(hatchLines(rings, spacing, angleDeg + 90));
    case "concentric":
      return concentricRings(rings, spacing);
    default:
      return [];
  }
}
