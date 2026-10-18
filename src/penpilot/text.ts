/**
 * PenPilot text: single-line ("one stroke per letter") fonts for the plotter.
 * The fonts are the Hershey and EMS SVG fonts from the hersheytext package,
 * copied unchanged into the UI build (fonts-single-line/); their licences are
 * in each file's <metadata> and in NOTICE.md.
 */

import type { Path } from "flatten-svg";

export const SINGLE_LINE_FONTS: { file: string; name: string }[] = [
  { file: "EMSReadability.svg", name: "EMS Readability" },
  { file: "EMSReadabilityItalic.svg", name: "EMS Readability Italic" },
  { file: "EMSAllure.svg", name: "EMS Allure (script)" },
  { file: "EMSFelix.svg", name: "EMS Felix (script)" },
  { file: "EMSElfin.svg", name: "EMS Elfin" },
  { file: "EMSNixish.svg", name: "EMS Nixish" },
  { file: "EMSNixishItalic.svg", name: "EMS Nixish Italic" },
  { file: "EMSOsmotron.svg", name: "EMS Osmotron" },
  { file: "EMSTech.svg", name: "EMS Tech" },
  { file: "HersheySans1.svg", name: "Hershey Sans" },
  { file: "HersheySansMed.svg", name: "Hershey Sans Medium" },
  { file: "HersheySerifMed.svg", name: "Hershey Serif" },
  { file: "HersheySerifMedItalic.svg", name: "Hershey Serif Italic" },
  { file: "HersheySerifBold.svg", name: "Hershey Serif Bold" },
  { file: "HersheySerifBoldItalic.svg", name: "Hershey Serif Bold Italic" },
  { file: "HersheyScript1.svg", name: "Hershey Script" },
  { file: "HersheyScriptMed.svg", name: "Hershey Script Medium" },
  { file: "HersheyGothEnglish.svg", name: "Hershey Gothic English" },
];
export const DEFAULT_FONT = "EMSReadability.svg";

export type Align = "left" | "centre" | "right";

export interface TextInfo {
  text: string;
  font: string;
  /** Height of capital letters, mm (before the item's own scale). */
  sizeMm: number;
  /** Extra space between letters, as a fraction of the capital height. */
  letterSpacing: number;
  /** Distance between lines, as a multiple of the font's normal line height. */
  lineSpacing: number;
  align: Align;
  /** Font couldn't be loaded, etc. */
  error?: string;
}

export const defaultText = (): TextInfo => ({
  text: "Hello",
  font: DEFAULT_FONT,
  sizeMm: 10,
  letterSpacing: 0,
  lineSpacing: 1,
  align: "left",
});

type Stroke = [number, number][];

export interface SingleLineFont {
  /** Declared ascent/descent (font units, y up): spacing between lines. */
  ascent: number;
  descent: number;
  /** Measured: top of the "H" (the declared cap-height is unreliable). */
  capHeight: number;
  /** Measured: highest and lowest points of any glyph, for the text box. */
  top: number;
  bottom: number;
  defaultAdvance: number;
  glyphs: Map<string, { advance: number; strokes: Stroke[] }>;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

/** Glyph outlines are straight-line polylines: "M x y L x y ... M ...", y pointing up. */
function parseStrokes(d: string): Stroke[] {
  const strokes: Stroke[] = [];
  let current: Stroke | null = null;
  for (const m of d.matchAll(/([ML])\s*([-\d.eE]+)[\s,]+([-\d.eE]+)/g)) {
    const p: [number, number] = [Number(m[2]), Number(m[3])];
    if (m[1] === "M") {
      if (current && current.length > 1) strokes.push(current);
      current = [p];
    } else current?.push(p);
  }
  if (current && current.length > 1) strokes.push(current);
  return strokes;
}

/** Read an SVG font file (text). Pure string parsing, so it also works in tests. */
export function parseSingleLineFont(svg: string): SingleLineFont {
  const fontTag = svg.match(/<font\b[^>]*>/)?.[0] ?? "";
  const faceTag = svg.match(/<font-face\b[^>]*>/)?.[0] ?? "";
  const face = attrs(faceTag);
  const defaultAdvance = Number(attrs(fontTag)["horiz-adv-x"] ?? 500);
  const glyphs = new Map<string, { advance: number; strokes: Stroke[] }>();
  for (const m of svg.matchAll(/<glyph\b[^>]*>/g)) {
    const a = attrs(m[0]);
    if (a.unicode === undefined) continue;
    glyphs.set(decodeEntities(a.unicode), {
      advance: Number(a["horiz-adv-x"] ?? defaultAdvance),
      strokes: a.d ? parseStrokes(a.d) : [],
    });
  }
  const ascent = Number(face.ascent ?? 800);
  const descent = Number(face.descent ?? -200);
  const yOf = (ch: string) => (glyphs.get(ch)?.strokes ?? []).flat().map((p) => p[1]);
  const hTop = Math.max(...yOf("H"));
  let top = ascent;
  let bottom = descent;
  for (const g of glyphs.values()) {
    for (const st of g.strokes) {
      for (const [, y] of st) {
        if (y > top) top = y;
        if (y < bottom) bottom = y;
      }
    }
  }
  return {
    ascent,
    descent,
    capHeight: Number.isFinite(hTop) && hTop > 0 ? hTop : Number(face["cap-height"] ?? 500),
    top,
    bottom,
    defaultAdvance,
    glyphs,
  };
}

const fontCache = new Map<string, Promise<SingleLineFont>>();

export function loadSingleLineFont(file: string): Promise<SingleLineFont> {
  let p = fontCache.get(file);
  if (!p) {
    p = fetch(`fonts-single-line/${file}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Font ${file} not found`);
        return r.text();
      })
      .then(parseSingleLineFont);
    p.catch(() => fontCache.delete(file));
    fontCache.set(file, p);
  }
  return p;
}

/**
 * Lay out text as pen strokes, in mm, top-left of the text box at (0, 0).
 * Returns the strokes and the box (used as the item's bounds, so editing the
 * text never makes the item jump).
 */
export function layoutText(font: SingleLineFont, t: TextInfo): { paths: Path[]; width: number; height: number } {
  const k = t.sizeMm / font.capHeight; // mm per font unit
  const lineHeight = (font.ascent - font.descent) * t.lineSpacing;
  const extra = t.letterSpacing * font.capHeight;
  const lines = t.text.split(/\r?\n/);
  const widths = lines.map((line) => {
    let w = 0;
    for (const ch of line) w += (font.glyphs.get(ch)?.advance ?? font.defaultAdvance) + extra;
    return line.length > 0 ? w - extra : 0;
  });
  const boxWidth = Math.max(...widths, 0);
  const paths: Path[] = [];
  lines.forEach((line, i) => {
    const baseline = font.top + i * lineHeight;
    let x = t.align === "centre" ? (boxWidth - widths[i]) / 2 : t.align === "right" ? boxWidth - widths[i] : 0;
    for (const ch of line) {
      const g = font.glyphs.get(ch);
      if (g) {
        for (const s of g.strokes) {
          paths.push({
            stroke: "black",
            groupId: "",
            points: s.map(([gx, gy]) => ({ x: (x + gx) * k, y: (baseline - gy) * k })),
          });
        }
      }
      x += (g?.advance ?? font.defaultAdvance) + extra;
    }
  });
  const height = font.top - font.bottom + (lines.length - 1) * lineHeight;
  return { paths, width: Math.max(boxWidth * k, t.sizeMm * 0.5), height: height * k };
}

/** Characters the font can't draw (e.g. Arabic in these Latin fonts). */
export function missingCharacters(font: SingleLineFont, text: string): string[] {
  const missing = new Set<string>();
  for (const ch of text) if (!/\s/.test(ch) && !font.glyphs.has(ch)) missing.add(ch);
  return [...missing];
}

export const textJobKey = (t: TextInfo) =>
  JSON.stringify([t.text, t.font, t.sizeMm, t.letterSpacing, t.lineSpacing, t.align]);
