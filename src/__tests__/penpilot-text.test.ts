import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  defaultText,
  layoutText,
  missingCharacters,
  parseSingleLineFont,
  SINGLE_LINE_FONTS,
} from "../penpilot/text.js";

const fontFile = (f: string) => readFileSync(`node_modules/hersheytext/svg_fonts/${f}`, "utf8");

describe("PenPilot single-line text", () => {
  it("reads every bundled font", () => {
    for (const { file } of SINGLE_LINE_FONTS) {
      const font = parseSingleLineFont(fontFile(file));
      expect(font.capHeight).toBeGreaterThan(600); // measured from "H"
      expect(font.top).toBeGreaterThanOrEqual(800);
      expect(font.bottom).toBeLessThanOrEqual(-200);
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
