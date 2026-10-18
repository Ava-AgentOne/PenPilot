import { describe, expect, it } from "vitest";
import { Device, plan } from "../planning.js";

describe("PenPilot: reversed pen-lift motors", () => {
  it("keeps saxi's direction by default (pen up = larger servo value)", () => {
    const d = Device("v3");
    expect(d.penPctToPos(50)).toBeGreaterThan(d.penPctToPos(60));
  });

  it("mirrors the scale when reversed, so 'up' becomes the smaller servo value", () => {
    const normal = Device("v3");
    const reversed = Device("v3", true);
    expect(reversed.penPctToPos(50)).toBeLessThan(reversed.penPctToPos(60));
    for (const pct of [0, 25, 50, 60, 100]) {
      expect(reversed.penPctToPos(pct)).toBe(normal.penPctToPos(100 - pct));
    }
    expect(Device("brushless", true).penPctToPos(30)).toBe(Device("brushless").penPctToPos(70));
  });

  it("starts every plan with a pen-down move from the pen-up position (drivers rely on this)", () => {
    const reversed = Device("v3", true);
    const up = reversed.penPctToPos(50);
    const down = reversed.penPctToPos(60);
    const profile = { acceleration: 100, maximumVelocity: 100, corneringFactor: 0 };
    const p = plan(
      [
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
      ],
      {
        penUpPos: up,
        penDownPos: down,
        penDownProfile: profile,
        penUpProfile: profile,
        penDropDuration: 0.1,
        penLiftDuration: 0.1,
      },
    );
    const penMotions = p.motions.filter((m) => "initialPos" in m) as { initialPos: number; finalPos: number }[];
    expect(penMotions[0]).toMatchObject({ initialPos: up, finalPos: down });
    expect(penMotions[penMotions.length - 1]).toMatchObject({ initialPos: down, finalPos: up });
  });
});
