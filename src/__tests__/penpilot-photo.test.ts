import { describe, expect, it } from "vitest";
import { itemSize, newPhotoItem, pageReducer, setPhotoDetail } from "../penpilot/page.js";
import { parsePlotterfunPath, photoJobKey, rasterSize, withDefaults } from "../penpilot/photo.js";

describe("PenPilot photos: reading Plotterfun results", () => {
  it("reads polylines (postLines format)", () => {
    const paths = parsePlotterfunPath(" M1.00,2.00L3.00,4.00L5.50,6.25 M10.00,10.00L11.00,10.00");
    expect(paths.map((p) => p.points)).toEqual([
      [
        { x: 1, y: 2 },
        { x: 3, y: 4 },
        { x: 5.5, y: 6.25 },
      ],
      [
        { x: 10, y: 10 },
        { x: 11, y: 10 },
      ],
    ]);
  });

  it("turns circles (postCircles format) into small closed rings", () => {
    const [ring] = parsePlotterfunPath("M10.00,8.00 a 2.000 2.000 0 1 0 0.001 0Z ");
    const first = ring.points[0];
    const last = ring.points[ring.points.length - 1];
    expect(first.x).toBeCloseTo(10);
    expect(first.y).toBeCloseTo(8);
    expect(last.x).toBeCloseTo(first.x);
    expect(last.y).toBeCloseTo(first.y);
    for (const p of ring.points) expect(Math.hypot(p.x - 10, p.y - 10)).toBeCloseTo(2);
  });

  it("ignores lone points and empty input", () => {
    expect(parsePlotterfunPath("")).toEqual([]);
    expect(parsePlotterfunPath(" M1,1")).toEqual([]);
  });
});

describe("PenPilot photos: items", () => {
  const bitmap = { width: 4000, height: 3000 } as ImageBitmap;
  const page = { x: 297, y: 210 };

  it("works at 800 px on the long side and fits the page margins", () => {
    expect(rasterSize(bitmap, 800)).toEqual({ width: 800, height: 600 });
    const item = newPhotoItem("cat.jpg", bitmap, "blob:x", page, 20);
    expect(item.bounds).toEqual({ minX: 0, minY: 0, maxX: 800, maxY: 600 });
    const s = itemSize(item);
    expect(s.y).toBeCloseTo(170); // 210 - 2 x 20 limits it (4:3)
    expect(item.photo?.style).toBe("squiggle.js");
  });

  it("keeps its size and place on the page when the detail changes", () => {
    const item = newPhotoItem("cat.jpg", bitmap, "blob:x", page, 20);
    const withLines = { ...item, paths: [{ stroke: "black", groupId: "", points: [{ x: 800, y: 600 }] }] };
    const finer = setPhotoDetail(withLines, 1600);
    expect(finer.photo?.width).toBe(1600);
    expect(itemSize(finer).x).toBeCloseTo(itemSize(item).x);
    expect([finer.x, finer.y]).toEqual([item.x, item.y]);
    expect(finer.paths[0].points[0]).toEqual({ x: 1600, y: 1200 }); // old lines rescaled until redrawn
  });

  it("changing style resets that style's controls but keeps shared values", () => {
    const item = newPhotoItem("cat.jpg", bitmap, "blob:x", page, 20);
    let p = pageReducer(
      { items: [item], selectedId: null },
      {
        type: "photoMeta",
        id: item.id,
        controls: [{ label: "Brightness", value: 0, min: -100, max: 100 }],
        config: { Brightness: 30 },
      },
    );
    p = pageReducer(p, { type: "photoSettings", id: item.id, style: "spiral.js" });
    expect(p.items[0].photo?.style).toBe("spiral.js");
    expect(p.items[0].photo?.controls).toEqual([]);
    expect(p.items[0].photo?.config).toEqual({ Brightness: 30 });
    expect(p.items[0].photo?.status).toBe("working");
  });

  it("fills in style defaults and keys jobs by what would be drawn", () => {
    const full = withDefaults(
      [
        { label: "Inverted", type: "checkbox" },
        { label: "Line Count", value: 50, min: 10, max: 200 },
        { label: "Modulation", type: "select", value: "both", options: ["both", "AM", "FM"] },
      ],
      { "Line Count": 80 },
    );
    expect(full).toEqual({ Inverted: false, "Line Count": 80, Modulation: "both" });
    // Linedraw declares its tick-boxes with `checked`
    expect(withDefaults([{ label: "Hatching", type: "checkbox", checked: true }], {})).toEqual({ Hatching: true });
    const a = photoJobKey({ style: "squiggle.js", detail: 800, config: { a: 1, b: 2 } });
    const b = photoJobKey({ style: "squiggle.js", detail: 800, config: { b: 2, a: 1 } });
    expect(a).toBe(b);
  });
});
