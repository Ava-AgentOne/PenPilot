import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  defaultText,
  layoutText,
  missingCharacters,
  parseSingleLineFont,
  SINGLE_LINE_FONTS,
} from "../penpilot/text.js";

const fontFile = (f: string) =>
  readFileSync(`vendor/single-line-fonts/${f.startsWith("EMS") ? "EMS" : "Hershey"}/${f}`, "utf8");

describe("PenPilot single-line text", () => {
  it("reads every bundled font", () => {
    for (const { file } of SINGLE_LINE_FONTS) {
      const font = parseSingleLineFont(fontFile(file));
      expect(font.capHeight, file).toBeGreaterThan(0); // measured from "H"
      expect(font.top, file).toBeGreaterThan(font.capHeight * 0.99);
      expect(font.bottom, file).toBeLessThan(0);
      expect(font.glyphs.size, file).toBeGreaterThan(90);
      expect(font.glyphs.get("A")?.strokes.length, file).toBeGreaterThan(0);
      expect(font.glyphs.get(" ")?.strokes, file).toEqual([]);
      expect(font.glyphs.has('"'), `${file} decodes &#x22;`).toBe(true);
    }
  });

  it("sizes text by capital height, top-left at 0,0, y down", () => {
    const font = parseSingleLineFont(fontFile("HersheySans1.svg"));
    const { paths, width, height } = layoutText(font, { ...defaultText(), text: "H", sizeMm: 10 });
    const ys = paths.flatMap((p) => p.points.map((q) => q.y));
    // A 10 mm capital H, standing on the baseline, inside the text box.
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(10, 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(height);
    expect(width).toBeGreaterThan(0);
  });

  it("stacks lines, spaces letters and aligns", () => {
    const font = parseSingleLineFont(fontFile("EMSReadability.svg"));
    const one = layoutText(font, { ...defaultText(), text: "Hi" });
    const two = layoutText(font, { ...defaultText(), text: "Hi\nthere", lineSpacing: 1.5 });
    const lineMm = (1000 / font.capHeight) * 10; // declared line height (1000 units) at 10 mm capitals
    expect(two.height).toBeCloseTo(one.height + 1.5 * lineMm);
    const wide = layoutText(font, { ...defaultText(), text: "Hi", letterSpacing: 0.5 });
    expect(wide.width).toBeCloseTo(one.width + 0.5 * 10); // one gap of half a capital height
    const right = layoutText(font, { ...defaultText(), text: "Hello\nHi", align: "right" });
    const left = layoutText(font, { ...defaultText(), text: "Hello\nHi", align: "left" });
    const lastLineMinX = (r: typeof left) => Math.min(...r.paths.slice(-3).flatMap((p) => p.points.map((q) => q.x)));
    expect(lastLineMinX(right)).toBeGreaterThan(lastLineMinX(left) + 5);
  });

  it("reports characters the font can't draw", () => {
    const font = parseSingleLineFont(fontFile("EMSReadability.svg"));
    expect(missingCharacters(font, "Hi مرحبا")).toEqual(["م", "ر", "ح", "ب", "ا"]);
    expect(missingCharacters(font, "Hello, world!")).toEqual([]);
  });
});

describe("PenPilot single-line text: glyph paths", () => {
  it("reads lines, curves (flattened), closing and repeated coordinates", async () => {
    const { parseStrokes } = await import("../penpilot/text.js");
    const [line] = parseStrokes("M 0 0 L 10 0 20 0");
    expect(line).toEqual([
      [0, 0],
      [10, 0],
      [20, 0],
    ]);
    const [curve] = parseStrokes("M0,0 C0,10 10,10 10,0");
    expect(curve[0]).toEqual([0, 0]);
    expect(curve[curve.length - 1]).toEqual([10, 0]);
    expect(Math.max(...curve.map((p) => p[1]))).toBeCloseTo(7.5, 1); // a cubic's peak
    const [loop] = parseStrokes("M1 1 L5 1 L5 5 Z");
    expect(loop[loop.length - 1]).toEqual([1, 1]);
    expect(parseStrokes("M1 1 L2 2 M3 3 L4 4")).toHaveLength(2);
  });
});
