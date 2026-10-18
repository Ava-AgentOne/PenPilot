import { afterEach, describe, expect, it } from "vitest";
import { WebSerialDriver } from "../drivers.js";
import { MM_PER_SOURCE_UNIT, type PageItem, plannerSegments, splitByColour } from "../penpilot/page.js";
import {
  firstPen,
  loadPens,
  newPen,
  PEN_COLOURS,
  type Pen,
  testSquareLines,
  testSquarePlan,
  testSquareSlots,
  withPen,
} from "../penpilot/pens.js";
import { continuePlan, countBelow, drawnLines, joinPenPlans, partAt, penParts } from "../penpilot/plot-job.js";
import { Device, defaultPlanOptions, type Motion, PenChange, PenMotion, Plan, plan, XYMotion } from "../planning.js";
import type { Vec2 } from "../vec.js";

const profile = { acceleration: 1000, maximumVelocity: 500, corneringFactor: 0 };
const tooling = (up: number, down: number) => ({
  penUpPos: up,
  penDownPos: down,
  penDownProfile: profile,
  penUpProfile: profile,
  penDropDuration: 0.1,
  penLiftDuration: 0.1,
});
const line = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y1 },
];

/** Three lines with one pen, then two with another, joined into one plot. */
function twoPenPlot() {
  const a = plan([line(10, 10, 50, 10), line(10, 20, 50, 20), line(10, 30, 50, 30)], tooling(20000, 15000));
  const b = plan([line(60, 10, 90, 10), line(60, 20, 90, 20)], tooling(21000, 14000));
  return joinPenPlans([
    { penId: "black", penUpPos: 20000, plan: a },
    { penId: "red", penUpPos: 21000, plan: b },
    { penId: "unused", penUpPos: 22000, plan: plan([], tooling(22000, 13000)) },
  ]);
}

describe("PenPilot pens", () => {
  const realWindow = (globalThis as { window?: unknown }).window;
  afterEach(() => {
    (globalThis as { window?: unknown }).window = realWindow;
  });
  const withStorage = (data: Record<string, string>) => {
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => data[k] ?? null,
        setItem: (k: string, v: string) => {
          data[k] = v;
        },
      },
    };
  };

  it("starts with one pen made from the settings the app already had", () => {
    withStorage({});
    const pens = loadPens({ ...defaultPlanOptions, penUpHeight: 42, penDownHeight: 71, penDownMaxVelocity: 33 });
    expect(pens).toHaveLength(1);
    expect(pens[0]).toMatchObject({ upHeight: 42, downHeight: 71, speed: 33 });
  });

  it("reads saved pens safely: odd values fixed, repeated ids made unique", () => {
    withStorage({
      "penpilot.pens": JSON.stringify([
        { id: "a", name: "Fineliner", colour: "#123456", upHeight: 50, downHeight: 140, speed: "fast", widthMm: 0.3 },
        { id: "a", name: "", colour: "red", upHeight: 40, downHeight: 60, speed: 20, widthMm: 0.8 },
      ]),
    });
    const pens = loadPens(defaultPlanOptions);
    expect(pens).toHaveLength(2);
    expect(pens[0]).toMatchObject({ id: "a", name: "Fineliner", colour: "#123456", downHeight: 100, widthMm: 0.3 });
    expect(pens[0].speed).toBe(defaultPlanOptions.penDownMaxVelocity);
    expect(pens[1].id).not.toBe("a");
    expect(pens[1].name).toBe("My pen");
    expect(pens[1].colour).toMatch(/^#[0-9a-f]{6}$/i);
    withStorage({ "penpilot.pens": "not json" });
    expect(loadPens(defaultPlanOptions)).toHaveLength(1);
  });

  it("gives a new pen the next unused colour and its own name", () => {
    const base = firstPen(defaultPlanOptions);
    const second = newPen([base], base);
    expect(second.id).not.toBe(base.id);
    expect(second.colour).toBe(PEN_COLOURS[1]);
    expect(second.name).toBe("Pen 2");
    expect(second.upHeight).toBe(base.upHeight);
    const o = withPen(defaultPlanOptions, { ...second, upHeight: 30, downHeight: 80, speed: 12 });
    expect(o).toMatchObject({ penUpHeight: 30, penDownHeight: 80, penDownMaxVelocity: 12 });
  });

  it("draws the test square in the corner margin, half filled one pen-width apart", () => {
    const [square, zigzag] = testSquareLines(0.5, 0);
    const xs = square.map((p) => p.x);
    const ys = square.map((p) => p.y);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([5, 15, 5, 15]);
    expect(zigzag).toHaveLength(2 * 21); // rows 0.5 mm apart over 10 mm
    for (const p of zigzag) expect(p.x).toBeLessThanOrEqual(10 + 1e-9); // the left half only
    expect(testSquareLines(0.5, 2)[0][0].x).toBe(35); // later tests move along
    expect(testSquareSlots(297)).toBe(19);
    expect(testSquareSlots(10)).toBe(1);
    const pen: Pen = { ...firstPen(defaultPlanOptions), upHeight: 40, downHeight: 70 };
    const p = testSquarePlan(pen, defaultPlanOptions, 0);
    expect(drawnLines(p)).toHaveLength(2);
    const firstPenMove = p.motions.find((m): m is PenMotion => m instanceof PenMotion);
    expect(firstPenMove).toMatchObject({
      initialPos: Device("v3").penPctToPos(40),
      finalPos: Device("v3").penPctToPos(70),
    });
  });
});

describe("PenPilot plot jobs", () => {
  it("joins each pen's part with a pen change, leaving out pens with nothing to draw", () => {
    const p = twoPenPlot();
    const parts = penParts(p);
    expect(parts.map((x) => [x.penId, x.wait])).toEqual([
      ["black", false],
      ["red", true],
    ]);
    expect(parts[1].penUpPos).toBe(21000);
    expect(drawnLines(p)).toHaveLength(5);
    // The second pen starts from home: its part begins with a pen change, then travel.
    expect(p.motions[parts[1].start + 1]).toBeInstanceOf(XYMotion);
    expect(partAt(parts, drawnLines(p)[3])?.penId).toBe("red");
    // Survives the trip to and from the planning worker.
    const back = Plan.fromTransferable(p.toTransferable());
    expect(penParts(back)).toEqual(parts);
    expect(Plan.deserialize(JSON.parse(JSON.stringify(p.serialize())))).toEqual(back);
  });

  it("counts lines finished before a motion", () => {
    const lines = [2, 6, 10];
    expect([0, 2, 3, 6, 7, 11].map((i) => countBelow(lines, i))).toEqual([0, 0, 1, 1, 2, 3]);
  });

  it("continues from a line: drives there from home, then the rest as planned", () => {
    const p = twoPenPlot();
    const lines = drawnLines(p);
    const c = continuePlan(p, 1, defaultPlanOptions, "black");
    expect(c).not.toBeNull();
    if (!c) return;
    const m = c.plan.motions;
    expect(m[0]).toBeInstanceOf(PenChange);
    expect((m[0] as PenChange).wait).toBe(false); // the same pen is still in
    const lead = m[1] as XYMotion;
    expect(lead.p1).toEqual({ x: 0, y: 0 }); // home: where the plot started
    expect(lead.p2).toEqual({ x: 10, y: 20 }); // the start of line 2
    expect(m[2]).toBeInstanceOf(PenMotion);
    expect(drawnLines(c.plan)).toHaveLength(4);
    // Progress maps back onto the full plan: everything before line 2 reads as done.
    expect(countBelow(lines, c.toFull(0))).toBe(1);
    expect(c.toFull(3)).toBe(lines[1]);
    expect(c.toFull(m.length - 1)).toBe(p.motions.length - 1);
    // Continuing a red line while the black pen is in: stop for the red pen first.
    const red = continuePlan(p, 3, defaultPlanOptions, "black");
    expect(red?.plan.motions[0]).toMatchObject({ penId: "red", wait: true, penUpPos: 21000 });
    expect(drawnLines(red?.plan ?? new Plan([]))).toHaveLength(2);
    expect(continuePlan(p, 5, defaultPlanOptions, null)).toBeNull();
  });
});

describe("PenPilot page: pens and colours", () => {
  const item = (id: string, penId: string | undefined, strokes: string[]): PageItem => ({
    id,
    name: "Logo",
    paths: strokes.map((stroke, i) => ({ stroke, groupId: "", points: line(0, i, 10, i) })),
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: strokes.length },
    x: 20,
    y: 30,
    scale: 1,
    rotation: 0,
    penId,
  });

  it("groups the page's lines by pen, in the pens' order, keeping layer names", () => {
    const page = {
      items: [item("1", "red", ["#000"]), item("2", "black", ["#000", "#000"]), item("3", "red", ["#000"])],
      selectedId: null,
    };
    const segs = plannerSegments(page, "as-shown", { x: 297, y: 210 }, (it) => it.penId ?? "", ["black", "red"]);
    expect(segs.map((s) => [s.penId, s.paths.length])).toEqual([
      ["black", 2],
      ["red", 2],
    ]);
    // Same names as one big group would give (layer selection relies on them).
    expect(segs[1].paths.map((p) => p.groupId)).toEqual(["Logo", "Logo (3)"]);
    expect(segs[0].paths[0].points[0].x).toBeCloseTo(20 / MM_PER_SOURCE_UNIT, 6);
  });

  it("splits a drawing into one per colour, each exactly where it was", () => {
    const parts = splitByColour(item("1", "black", ["red", "blue", "red"]));
    expect(parts.map((p) => [p.name, p.paths.length])).toEqual([
      ["Logo · red", 2],
      ["Logo · blue", 1],
    ]);
    for (const p of parts) expect(p).toMatchObject({ x: 20, y: 30, scale: 1, bounds: { maxY: 3 } });
    expect(new Set(parts.map((p) => p.id)).size).toBe(2);
    expect(splitByColour(item("2", undefined, ["red"]))).toHaveLength(1);
  });
});

describe("PenPilot driver: pen changes and stops", () => {
  /** A WebSerialDriver over a pretend board that records what it's told. */
  function fakeDriver() {
    const log: string[] = [];
    const ebb = {
      hardware: "v3",
      enableMotors: async () => void log.push("motors on"),
      disableMotors: async () => void log.push("motors off"),
      waitUntilMotorsIdle: async () => {},
      setPenHeight: async (h: number) => void log.push(`pen ${h}`),
      executeMotion: async (m: Motion) => {
        if (m instanceof PenMotion) log.push(`pen ${m.finalPos}`);
        else if (m instanceof XYMotion) log.push(`move to ${m.p2.x},${m.p2.y}`);
      },
      executeXYMotion: async (m: XYMotion) => void log.push(`home to ${m.p2.x},${m.p2.y}`),
    };
    const d = Object.create(WebSerialDriver.prototype) as WebSerialDriver;
    Object.assign(d, {
      ebb,
      _unpaused: null,
      _signalUnpause: null,
      _cancelRequested: false,
      onprogress: () => {},
      onpause: () => {},
      onpenchange: () => {},
      onfinished: () => log.push("finished"),
      oncancelled: () => log.push("cancelled"),
    });
    return { d, log };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("waits at a pen change until Continue, then lifts the new pen", async () => {
    const { d, log } = fakeDriver();
    const changes: (string | null)[] = [];
    d.onpenchange = (id) => changes.push(id);
    const done = d.plot(twoPenPlot());
    for (let i = 0; i < 50 && changes.length === 0; i++) await tick();
    expect(changes).toEqual(["red"]);
    const before = log.length;
    await tick();
    expect(log.length).toBe(before); // still waiting
    d.resume();
    await done;
    expect(changes).toEqual(["red", null]);
    const i = log.indexOf("pen 21000");
    expect(i).toBeGreaterThan(before - 1); // red pen lifted to its own height
    expect(log.slice(-2)).toEqual(["motors off", "finished"]); // reported only once the motors are off
  });

  it("on Stop, lifts the pen and drives home, even while waiting for a pen", async () => {
    const { d, log } = fakeDriver();
    d.onpenchange = (id) => {
      if (id) d.cancel();
    };
    await d.plot(twoPenPlot());
    expect(log).toContain("cancelled");
    expect(log).not.toContain("move to 60,10"); // the red part never started
    expect(log.slice(-3)).toEqual(["pen 20000", "motors off", "cancelled"]); // already home: no extra move

    const stopMidway = fakeDriver();
    let n = 0;
    stopMidway.d.onprogress = () => {
      if (++n === 5) stopMidway.d.cancel(); // during the second travel move
    };
    await stopMidway.d.plot(twoPenPlot());
    expect(stopMidway.log.slice(-4)).toEqual(["pen 20000", "home to 0,0", "motors off", "cancelled"]);
  });
});
