import { describe, expect, it } from "vitest";
import { joinEnds, length, type Pt, simplify, smooth, toPathData } from "../penpilot/trace-geometry.js";

describe("PenPilot tracing: tidying lines", () => {
  it("simplifies open lines, keeping the corners", () => {
    const stairs: Pt[] = [
      [0, 0],
      [1, 0.2],
      [2, 0],
      [3, 0.2],
      [4, 0],
      [4.2, 2],
      [4, 4],
    ];
    expect(simplify(stairs, 0.5)).toEqual([
      [0, 0],
      [4, 0],
      [4, 4],
    ]);
  });

  it("keeps closed outlines as shapes (they start and end on the same point)", () => {
    const square: Pt[] = [
      [0, 0],
      [5, 0.1],
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ];
    const s = simplify(square, 0.5);
    expect(s.length).toBeGreaterThanOrEqual(5);
    expect(length(s)).toBeCloseTo(40, 0);
  });

  it("smooths corners but keeps the ends, and keeps loops closed", () => {
    const open: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 10],
    ];
    const s = smooth(open, 1);
    expect(s[0]).toEqual([0, 0]);
    expect(s[s.length - 1]).toEqual([10, 10]);
    const loop = smooth(
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 0],
      ],
      2,
    );
    expect(loop[0]).toEqual(loop[loop.length - 1]);
  });

  it("joins pieces whose ends touch, either way round", () => {
    const joined = joinEnds(
      [
        [
          [0, 0],
          [5, 0],
        ],
        [
          [9, 0],
          [5.5, 0.5],
        ],
        [
          [30, 30],
          [40, 40],
        ],
      ],
      1.5,
    );
    expect(joined).toHaveLength(2);
    expect(joined[0]).toEqual([
      [0, 0],
      [5, 0],
      [9, 0],
    ]);
  });

  it("writes Plotterfun-style path data", () => {
    expect(
      toPathData([
        [
          [1, 2],
          [3, 4],
        ],
      ]),
    ).toBe(" M1.00,2.00L3.00,4.00");
  });
});
