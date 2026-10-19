import { describe, expect, it } from "vitest";
import {
  emptyPage,
  itemDrawnPaths,
  itemSize,
  newShapeItem,
  type PageItem,
  pageReducer,
  resizeShape,
} from "../penpilot/page.js";
import { firstPen, type Pen } from "../penpilot/pens.js";
import { fileBaseName, pageToSvg, projectFromText, projectToText } from "../penpilot/project.js";
import { shapePaths } from "../penpilot/shapes.js";
import { defaultPlanOptions } from "../planning.js";
import type { Vec2 } from "../vec.js";

const page = { x: 297, y: 210 };
const box = (pts: Vec2[]) => ({
  minX: Math.min(...pts.map((p) => p.x)),
  minY: Math.min(...pts.map((p) => p.y)),
  maxX: Math.max(...pts.map((p) => p.x)),
  maxY: Math.max(...pts.map((p) => p.y)),
});

describe("PenPilot shapes", () => {
  it("draws rectangles, rounded rectangles and circles as closed outlines of the right size", () => {
    const rect = shapePaths({ kind: "rect", w: 60, h: 40, radius: 0, lines: 1, gap: 2 });
    expect(rect).toHaveLength(1);
    expect(box(rect[0].points)).toEqual({ minX: 0, minY: 0, maxX: 60, maxY: 40 });
    const round = shapePaths({ kind: "rect", w: 60, h: 40, radius: 5, lines: 1, gap: 2 })[0].points;
    expect(round[0]).toEqual(round[round.length - 1]);
    const b = box(round);
    expect([b.minX, b.minY, b.maxX, b.maxY].map((n) => Math.round(n * 1000) / 1000)).toEqual([0, 0, 60, 40]);
    const circle = shapePaths({ kind: "ellipse", w: 50, h: 50, radius: 0, lines: 1, gap: 2 })[0].points;
    expect(circle[0]).toEqual(circle[circle.length - 1]);
    for (const p of circle) expect(Math.hypot(p.x - 25, p.y - 25)).toBeCloseTo(25, 6);
  });

  it("draws extra lines inside the first, stopping when they meet", () => {
    const lines = shapePaths({ kind: "rect", w: 20, h: 10, radius: 0, lines: 4, gap: 2 });
    expect(lines).toHaveLength(3); // the 4th would be 8 mm inside a 10 mm-tall box
    expect(box(lines[1].points)).toEqual({ minX: 2, minY: 2, maxX: 18, maxY: 8 });
  });

  it("puts a border just inside the margins, and stretches shapes freely", () => {
    const border = newShapeItem("border", page, 20);
    expect([border.x, border.y]).toEqual([20, 20]);
    expect(itemSize(border)).toEqual({ x: 257, y: 170 });
    expect(border.paths).toHaveLength(2);
    const rect = newShapeItem("rect", page, 20);
    const wide = resizeShape(rect, 100, 20);
    expect(itemSize(wide)).toEqual({ x: 100, y: 20 });
    expect(wide.shape).toMatchObject({ w: 100, h: 20 });
    // Turned a quarter: the page width is the shape's height.
    const turned = resizeShape({ ...rect, rotation: 90 }, 100, 20);
    expect(turned.shape).toMatchObject({ w: 20, h: 100 });
    expect(itemSize(turned)).toEqual({ x: 100, y: 20 });
    // A scaled shape (e.g. Fit page) takes the scale into its size, keeping its corners.
    const fitted = pageReducer({ items: [rect], selectedId: null }, { type: "update", item: { ...rect, scale: 2 } });
    expect(fitted.items[0]).toMatchObject({ scale: 1, shape: { w: 120, h: 80, radius: 0 } });
    const changed = pageReducer(fitted, { type: "shape", id: rect.id, shape: { radius: 4, lines: 2 } });
    expect(changed.items[0].paths).toHaveLength(2);
    // Shapes can be filled like any closed shape.
    expect(itemDrawnPaths({ ...rect, fill: { kind: "lines", spacingMm: 1, angle: 0, outline: true } }).shapes).toBe(1);
  });
});

describe("PenPilot projects", () => {
  const pen: Pen = { ...firstPen(defaultPlanOptions), id: "pen-a", name: "Red & <gel>", colour: "#ff0000" };
  const svgItem: PageItem = {
    id: "item-1",
    name: "“Logo”",
    paths: [
      {
        stroke: "red",
        groupId: "g1",
        points: [
          { x: 1.23456, y: 2 },
          { x: 3, y: 4 },
        ],
      },
    ],
    bounds: { minX: 1, minY: 2, maxX: 3, maxY: 4 },
    x: 10,
    y: 20,
    scale: 2,
    rotation: 90,
    penId: "pen-a",
    svgText: "<svg/>",
    fill: { kind: "cross", spacingMm: 0.4, angle: 30, outline: false },
  };

  it("saves and reopens a page with its drawings, paper and pens", async () => {
    const shape = { ...newShapeItem("ellipse", page, 20), penId: "pen-a" };
    const text: PageItem = {
      ...newShapeItem("rect", page, 20),
      shape: undefined,
      name: "Text",
      text: {
        text: "مرحبا",
        font: "traced:amiri",
        sizeMm: 12,
        letterSpacing: 0,
        lineSpacing: 1,
        align: "right",
        style: "filled",
        error: "x",
      },
    };
    const saved = await projectToText(
      { paper: { width: 210, height: 297, margin: 15 }, pens: [pen], items: [svgItem, shape, text] },
      "0.7.0",
    );
    const back = await projectFromText(saved);
    expect(back.paper).toEqual({ width: 210, height: 297, margin: 15 });
    expect(back.pens).toEqual([pen]);
    expect(back.items).toHaveLength(3);
    const [a, b, c] = back.items;
    expect(a.id).not.toBe(svgItem.id); // fresh ids
    expect(a).toMatchObject({
      name: "“Logo”",
      x: 10,
      y: 20,
      scale: 2,
      rotation: 90,
      penId: "pen-a",
      svgText: "<svg/>",
      fill: svgItem.fill,
      restored: true,
    });
    expect(a.paths[0]).toEqual({
      stroke: "red",
      groupId: "g1",
      points: [
        { x: 1.235, y: 2 },
        { x: 3, y: 4 },
      ],
    });
    expect(b.shape).toEqual(shape.shape);
    expect(b.paths.length).toBe(shape.paths.length);
    expect(c.text).toMatchObject({ text: "مرحبا", font: "traced:amiri", style: "filled" });
    expect(c.text?.error).toBeUndefined();
    const loaded = pageReducer(emptyPage, { type: "load", items: back.items });
    expect(loaded.items).toHaveLength(3);
  });

  it("explains files it can't open", async () => {
    await expect(projectFromText("hello")).rejects.toThrow("isn't a PenPilot project");
    await expect(projectFromText(JSON.stringify({ format: "other", items: [] }))).rejects.toThrow("isn't a PenPilot");
    const future = JSON.stringify({ format: "penpilot-project", version: 99, items: [], paper: {} });
    await expect(projectFromText(future)).rejects.toThrow("newer PenPilot");
    const damaged = JSON.stringify({
      format: "penpilot-project",
      version: 1,
      paper: { width: 297, height: 210, margin: 20 },
      items: [{ name: "x", paths: [], bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, x: "left", y: 0, scale: 1 }],
    });
    await expect(projectFromText(damaged)).rejects.toThrow("damaged");
  });

  it("exports the page as an SVG in mm, one layer per pen, fills included", () => {
    const black: Pen = { ...firstPen(defaultPlanOptions), id: "pen-b", name: "Black", colour: "#222222", widthMm: 0.3 };
    const square = { ...newShapeItem("rect", page, 20), penId: "pen-b" };
    const filled = { ...square, fill: { kind: "lines" as const, spacingMm: 2, angle: 0, outline: true } };
    const svg = pageToSvg([filled, svgItem], page, [black, pen], (it) => (it.penId === "pen-a" ? pen : black));
    expect(svg).toContain('width="297mm" height="210mm" viewBox="0 0 297 210"');
    expect(svg).toContain('inkscape:label="1 Black"');
    expect(svg).toContain('inkscape:label="2 Red &amp; &lt;gel&gt;"');
    expect(svg).toContain('stroke="#222222" stroke-width="0.3"');
    expect(svg).toContain(`M${square.x} ${square.y}L${square.x + 60} ${square.y}`); // the rectangle, in page mm
    expect((svg.match(/<path /g) ?? []).length).toBe(2);
    // The hatching is in there too: many more line starts than the outline's one.
    expect((svg.split("\n")[3].match(/M/g) ?? []).length).toBeGreaterThan(1);
    expect(pageToSvg([], page, [black], () => black)).not.toContain("<g");
  });

  it("keeps each drawing's plot tick, and unticks the ones just plotted", async () => {
    const a = newShapeItem("rect", page, 20);
    const b = newShapeItem("ellipse", page, 20);
    const c = newShapeItem("border", page, 20);
    let p = pageReducer(emptyPage, { type: "add", items: [a, b, c] });
    p = pageReducer(p, { type: "plot", id: b.id, on: false });
    expect(p.items.map((it) => !!it.skip)).toEqual([false, true, false]);
    p = pageReducer(p, { type: "plot", id: b.id, on: true });
    expect(p.items[1].skip).toBeUndefined();
    p = pageReducer(p, { type: "unplot", ids: [a.id, c.id] });
    expect(p.items.map((it) => !!it.skip)).toEqual([true, false, true]);
    const back = await projectFromText(
      await projectToText({ paper: { width: 297, height: 210, margin: 20 }, pens: [], items: p.items }, "test"),
    );
    expect(back.items.map((it) => !!it.skip)).toEqual([true, false, true]);
  });

  it("keeps a damaged file's settings within safe limits", async () => {
    const file = JSON.stringify({
      format: "penpilot-project",
      version: 1,
      paper: { width: 1e9, height: 297, margin: 5000 },
      pens: [],
      items: [
        {
          name: "Huge shape",
          paths: [],
          bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
          x: 0,
          y: 0,
          scale: 0,
          rotation: 45,
          shape: { kind: "star", w: 1e9, h: -5, radius: 1e9, lines: 1e6, gap: -1 },
          fill: { kind: "lines", spacingMm: 1e-9, angle: Number.MAX_VALUE, outline: false },
          text: { text: "x".repeat(10000), font: "f", sizeMm: 1e9, letterSpacing: 99, lineSpacing: 0, align: "up" },
        },
      ],
    });
    const p = await projectFromText(file);
    expect(p.paper).toEqual({ width: 2000, height: 297, margin: 148.5 });
    const it = p.items[0];
    expect(it.rotation).toBe(0);
    expect(it.scale).toBeGreaterThan(0);
    expect(it.shape).toEqual({ kind: "rect", w: 2000, h: 3, radius: 1.5, lines: 10, gap: 0.1 });
    expect(it.fill).toMatchObject({ kind: "lines", spacingMm: 0.1, outline: false });
    expect(it.text).toMatchObject({ sizeMm: 500, letterSpacing: 5, lineSpacing: 0.3, align: "left" });
    expect(it.text?.text).toHaveLength(5000);
  });

  it("makes safe file names", () => {
    expect(fileBaseName("“Hello”")).toBe("Hello");
    expect(fileBaseName("card.penpilot")).toBe("card");
    expect(fileBaseName('a/b:c*?"<>|')).toBe("abc");
    expect(fileBaseName("  ")).toBe("My page");
  });
});
