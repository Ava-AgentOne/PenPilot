import { describe, expect, it } from "vitest";
import { closedRings, concentricRings, fillShapes, hatchLines } from "../penpilot/hatch.js";
import type { Vec2 } from "../vec.js";

const square = (x: number, y: number, s: number): Vec2[] => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
  { x, y },
];
const len = (l: Vec2[]) => l.slice(1).reduce((a, p, i) => a + Math.hypot(p.x - l[i].x, p.y - l[i].y), 0);

describe("PenPilot hatch fill", () => {
  it("finds the closed shapes", () => {
    const open: Vec2[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 5 },
      { x: 0, y: 4 },
    ];
    expect(closedRings([square(0, 0, 10), open], 0.01)).toHaveLength(1);
  });

  it("fills a square with evenly spaced lines, joined into one zig-zag", () => {
    const lines = hatchLines([square(0, 0, 10)], 1, 0);
    expect(lines).toHaveLength(1); // the pen never lifts
    const zz = lines[0];
    const rows = zz.length / 2;
    expect(rows).toBeGreaterThanOrEqual(9);
    expect(rows).toBeLessThanOrEqual(11);
    for (let i = 0; i < rows; i++) {
      const [a, b] = [zz[2 * i], zz[2 * i + 1]];
      expect(a.y).toBeCloseTo(b.y, 9); // each row is a straight line across
      expect(Math.abs(b.x - a.x)).toBeCloseTo(10, 5);
      if (i > 0) expect(Math.sign(b.x - a.x)).toBe(-Math.sign(zz[2 * i - 1].x - zz[2 * i - 2].x)); // back and forth
    }
    expect(len(zz)).toBeCloseTo(rows * 10 + (rows - 1) * 1, 5);
  });

  it("keeps holes empty and never jumps a gap", () => {
    const along = (ls: Vec2[][]) =>
      ls.flatMap((l) => l.slice(1).flatMap((p, i) => Array.from({ length: 21 }, (_, k) => lerp(l[i], p, k / 20))));
    const lerp = (a: Vec2, b: Vec2, f: number) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
    // A square with a square hole: lines go round the hole, not through it.
    const holed = along(hatchLines([square(0, 0, 10), square(3, 3, 4)], 1, 0));
    expect(holed.some((p) => p.x > 3.05 && p.x < 6.95 && p.y > 3.05 && p.y < 6.95)).toBe(false);
    expect(holed.some((p) => p.y > 3.2 && p.y < 6.8 && p.x < 3)).toBe(true);
    expect(holed.some((p) => p.y > 3.2 && p.y < 6.8 && p.x > 7)).toBe(true);
    // Two squares half a line apart: each is filled, nothing crosses between.
    for (const angle of [0, 45, 90]) {
      const pair = along(hatchLines([square(0, 0, 10), square(10.5, 0, 10)], 1, angle));
      expect(pair.some((p) => p.x > 10.05 && p.x < 10.45)).toBe(false);
    }
  });

  it("turns lines to the angle given", () => {
    const [l] = hatchLines([square(0, 0, 10)], 1, 90);
    expect(Math.abs(l[0].x - l[1].x)).toBeLessThan(1e-9); // vertical
    const lines = len(hatchLines([square(0, 0, 10)], 1, 0)[0]);
    const cross = fillShapes([square(0, 0, 10)], "cross", 1, 0);
    expect(cross).toHaveLength(2); // one zig-zag each way
    expect(len(cross[0]) + len(cross[1])).toBeCloseTo(2 * lines, 5);
  });

  it("draws shrinking outlines for a concentric fill", () => {
    const rings = concentricRings([square(0, 0, 10)], 1);
    expect(rings.length).toBe(4); // 8, 6, 4, 2 mm wide; 0 is nothing
    expect(len(rings[0])).toBeCloseTo(4 * 8, 0);
    for (const r of rings) expect(r[0]).toEqual(r[r.length - 1]);
  });

  it("does nothing for no shapes or no spacing", () => {
    expect(fillShapes([], "lines", 1, 0)).toEqual([]);
    expect(fillShapes([square(0, 0, 1)], "none", 1, 0)).toEqual([]);
    expect(hatchLines([square(0, 0, 1)], 0, 0)).toEqual([]);
  });
});
