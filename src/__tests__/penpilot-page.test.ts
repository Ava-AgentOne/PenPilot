import type { Path } from "flatten-svg";
import { describe, expect, it } from "vitest";
import {
  choosePlacement,
  drawableArea,
  drawableOnPage,
  drawingBoxOnMachine,
  fitItem,
  itemOverflows,
  itemPointToPage,
  itemSize,
  MM_PER_SOURCE_UNIT,
  machineToPage,
  newItem,
  type PageItem,
  pageReducer,
  pageToMachine,
  plannerPaths,
  rotateItem,
} from "../penpilot/page.js";

const V3 = { x: 300, y: 218 };
const A4_LANDSCAPE = { x: 297, y: 210 };
const A4_PORTRAIT = { x: 210, y: 297 };

/** A 96 x 48 source-unit rectangle outline (25.4 x 12.7 mm at natural size). */
const rect: Path[] = [
  {
    stroke: "black",
    groupId: "",
    points: [
      { x: 0, y: 0 },
      { x: 96, y: 0 },
      { x: 96, y: 48 },
      { x: 0, y: 48 },
      { x: 0, y: 0 },
    ],
  },
];

const item = (over: Partial<PageItem> = {}): PageItem => ({
  id: "a",
  name: "rect.svg",
  paths: rect,
  bounds: { minX: 0, minY: 0, maxX: 96, maxY: 48 },
  x: 10,
  y: 20,
  scale: 1,
  rotation: 0,
  ...over,
});

const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe("PenPilot page: placement on the AxiDraw V3", () => {
  it("plots A4 landscape as shown and A4 portrait turned sideways", () => {
    expect(choosePlacement(A4_LANDSCAPE, V3)).toBe("as-shown");
    expect(choosePlacement(A4_PORTRAIT, V3)).toBe("sideways");
    expect(choosePlacement({ x: 148, y: 210 }, V3)).toBe("as-shown"); // A5 portrait fits as shown
    expect(choosePlacement({ x: 420, y: 297 }, V3)).toBe("as-shown"); // A3: too big either way, long side on X
    expect(choosePlacement(A4_PORTRAIT, null)).toBe("as-shown"); // unknown machine
  });

  it("maps page <-> machine both ways, sideways putting the page's top-right at home", () => {
    close(pageToMachine({ x: 210, y: 0 }, "sideways", A4_PORTRAIT), { x: 0, y: 0 });
    close(pageToMachine({ x: 0, y: 0 }, "sideways", A4_PORTRAIT), { x: 0, y: 210 });
    close(pageToMachine({ x: 0, y: 297 }, "sideways", A4_PORTRAIT), { x: 297, y: 210 });
    for (const p of [
      { x: 12, y: 34 },
      { x: 200, y: 290 },
    ]) {
      close(machineToPage(pageToMachine(p, "sideways", A4_PORTRAIT), "sideways", A4_PORTRAIT), p);
    }
  });

  it("limits the drawable area to the reach, and reports it on the page", () => {
    expect(drawableArea("as-shown", { x: 420, y: 297 }, V3)).toEqual({ x: 300, y: 218 });
    expect(drawableOnPage("sideways", A4_PORTRAIT, drawableArea("sideways", A4_PORTRAIT, V3))).toEqual({
      minX: 0,
      minY: 0,
      maxX: 210,
      maxY: 297,
    });
  });
});

describe("PenPilot page: items", () => {
  it("rotates points the same way as the item's box", () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const it = item({ rotation });
      const { x: w, y: h } = itemSize(it);
      const corners = rect[0].points.slice(0, 4).map((p) => itemPointToPage(it, p));
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      expect(Math.min(...xs)).toBeCloseTo(10);
      expect(Math.min(...ys)).toBeCloseTo(20);
      expect(Math.max(...xs)).toBeCloseTo(10 + w);
      expect(Math.max(...ys)).toBeCloseTo(20 + h);
    }
    // 90° clockwise: the source's top-left corner ends up top-right.
    close(itemPointToPage(item({ rotation: 90 }), { x: 0, y: 0 }), { x: 10 + 48, y: 20 });
  });

  it("keeps the centre when rotating", () => {
    const it = item();
    const turned = rotateItem(it);
    expect(turned.rotation).toBe(90);
    const c = (i: PageItem) => ({ x: i.x + itemSize(i).x / 2, y: i.y + itemSize(i).y / 2 });
    close(c(turned), c(it));
    expect(rotateItem(rotateItem(rotateItem(turned))).rotation).toBe(0);
  });

  it("adds new drawings at natural size, or shrinks big ones to fit the margins", () => {
    const small = newItem("small.svg", rect, A4_LANDSCAPE, 20);
    expect(small?.scale).toBeCloseTo(MM_PER_SOURCE_UNIT);
    expect(small && itemSize(small).x).toBeCloseTo(25.4);
    const big = newItem("big.svg", rect, A4_LANDSCAPE, 20);
    const huge = big && fitItem({ ...big, scale: 50 }, A4_LANDSCAPE, 20);
    expect(huge && itemSize(huge).x).toBeCloseTo(257); // 297 - 2 x 20
    expect(newItem("empty.svg", [], A4_LANDSCAPE, 20)).toBeNull();
  });

  it("flags items that stick out of the drawable area", () => {
    const area = { minX: 0, minY: 0, maxX: 297, maxY: 210 };
    expect(itemOverflows(item(), area)).toBe(false);
    expect(itemOverflows(item({ x: 280 }), area)).toBe(true);
  });

  it("builds planner lines in machine coordinates and finds the frame box", () => {
    const page = { items: [item({ x: 0, y: 0, scale: MM_PER_SOURCE_UNIT })], selectedId: null };
    const lines = plannerPaths(page, "sideways", A4_PORTRAIT);
    expect(lines).toHaveLength(1);
    expect(lines[0].groupId).toBe("rect.svg");
    // Page (0,0) -> machine (0, 210) mm -> source units
    close(lines[0].points[0], { x: 0, y: 210 / MM_PER_SOURCE_UNIT });
    const box = drawingBoxOnMachine(page, "sideways", A4_PORTRAIT, drawableArea("sideways", A4_PORTRAIT, V3));
    expect(box?.minX).toBeCloseTo(0);
    expect(box?.maxX).toBeCloseTo(12.7);
    expect(box?.minY).toBeCloseTo(210 - 25.4);
    expect(box?.maxY).toBeCloseTo(210);
  });

  it("adds, selects, updates and removes items", () => {
    let page = pageReducer({ items: [], selectedId: null }, { type: "add", items: [item(), item({ id: "b" })] });
    expect(page.selectedId).toBe("b");
    page = pageReducer(page, { type: "update", item: item({ id: "a", x: 99 }) });
    expect(page.items[0].x).toBe(99);
    page = pageReducer(page, { type: "nudge", id: "a", dx: 1, dy: -2 });
    page = pageReducer(page, { type: "nudge", id: "a", dx: 1, dy: -2 });
    expect([page.items[0].x, page.items[0].y]).toEqual([101, 16]);
    page = pageReducer(page, { type: "update", item: item({ id: "a", x: 99 }) });
    page = pageReducer(page, { type: "remove", id: "b" });
    expect(page).toEqual({ items: [item({ id: "a", x: 99 })], selectedId: null });
  });
});

describe("PenPilot frame", () => {
  it("goes round the box with the pen up the whole time, then home", async () => {
    const { framePlan } = await import("../penpilot/frame.js");
    const { defaultPlanOptions, Device, XYMotion, PenMotion } = await import("../planning.js");
    const p = framePlan({ minX: 10, minY: 20, maxX: 110, maxY: 80 }, defaultPlanOptions, 2);
    const up = Device("v3").penPctToPos(defaultPlanOptions.penUpHeight);
    const pens = p.motions.filter((m) => m instanceof PenMotion);
    expect(pens.length).toBeGreaterThan(0);
    for (const m of pens) expect([m.initialPos, m.finalPos]).toEqual([up, up]);
    const xy = p.motions.filter((m) => m instanceof XYMotion);
    const pts = xy.flatMap((m) => m.points());
    const xs = pts.map((q) => q.x / 5);
    const ys = pts.map((q) => q.y / 5);
    expect(Math.max(...xs)).toBeCloseTo(110);
    expect(Math.max(...ys)).toBeCloseTo(80);
    expect(xy[xy.length - 1].p2).toEqual({ x: 0, y: 0 }); // back home
    expect(p.duration()).toBeGreaterThan(0);
  });
});

describe("PenPilot planning with cropping", () => {
  it("doesn't crash when cropping removes or splits lines and layers are in use", async () => {
    const { replan } = await import("../massager.js");
    const { defaultPlanOptions } = await import("../planning.js");
    const { PaperSize } = await import("../paper-size.js");
    const px = (mm: number) => mm / MM_PER_SOURCE_UNIT;
    const inPaths: Path[] = [
      // entirely outside the 100 x 100 mm area: cropping drops it
      {
        stroke: "black",
        groupId: "far.svg",
        points: [
          { x: px(150), y: px(10) },
          { x: px(190), y: px(10) },
        ],
      },
      // crosses the edge: cropping shortens it
      {
        stroke: "black",
        groupId: "edge.svg",
        points: [
          { x: px(50), y: px(50) },
          { x: px(150), y: px(50) },
        ],
      },
      // inside, but its layer is switched off
      {
        stroke: "black",
        groupId: "off.svg",
        points: [
          { x: px(10), y: px(10) },
          { x: px(20), y: px(10) },
        ],
      },
    ];
    const plan = replan(inPaths, {
      ...defaultPlanOptions,
      paperSize: new PaperSize({ x: 100, y: 100 }),
      marginMm: 0,
      fitPage: false,
      cropToMargins: true,
      layerMode: "group",
      selectedGroupLayers: new Set(["far.svg", "edge.svg"]),
      selectedStrokeLayers: new Set(),
    });
    const { XYMotion } = await import("../planning.js");
    const drawn = plan.motions.filter((m) => m instanceof XYMotion).filter((_m, i) => i % 2 === 1);
    expect(drawn).toHaveLength(1); // only the cropped edge line
    const xs = drawn[0].points().map((p) => p.x / 5);
    expect(Math.min(...xs)).toBeCloseTo(50);
    expect(Math.max(...xs)).toBeCloseTo(100);
  });
});
