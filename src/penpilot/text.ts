/**
 * PenPilot text: single-line ("one stroke per letter") fonts for the plotter.
 * The fonts are the Hershey and EMS SVG fonts from the hersheytext package,
 * copied unchanged into the UI build (fonts-single-line/); their licences are
 * in each file's <metadata> and in NOTICE.md.
 */

import type { Path } from "flatten-svg";

/** Single-stroke fonts (vendor/single-line-fonts): handwriting/script first. */
export const SINGLE_LINE_FONTS: { file: string; name: string; group: "script" | "print" }[] = [
  { file: "EMSCasualHand.svg", name: "EMS Casual Hand", group: "script" },
  { file: "EMSNeato.svg", name: "EMS Neato", group: "script" },
  { file: "EMSPepita.svg", name: "EMS Pepita", group: "script" },
  { file: "EMSTech.svg", name: "EMS Tech (architect's hand)", group: "script" },
  { file: "EMSDelight.svg", name: "EMS Delight", group: "script" },
  { file: "EMSDelightSwashCaps.svg", name: "EMS Delight Swash Caps", group: "script" },
  { file: "EMSPancakes.svg", name: "EMS Pancakes", group: "script" },
  { file: "EMSAllure.svg", name: "EMS Allure", group: "script" },
  { file: "EMSCapitol.svg", name: "EMS Capitol", group: "script" },
  { file: "EMSSociety.svg", name: "EMS Society", group: "script" },
  { file: "EMSInvite.svg", name: "EMS Invite", group: "script" },
  { file: "EMSSwiss.svg", name: "EMS Swiss", group: "script" },
  { file: "EMSBrush.svg", name: "EMS Brush", group: "script" },
  { file: "EMSBird.svg", name: "EMS Bird", group: "script" },
  { file: "EMSBirdSwashCaps.svg", name: "EMS Bird Swash Caps", group: "script" },
  { file: "EMSDecorousScript.svg", name: "EMS Decorous Script", group: "script" },
  { file: "EMSLeague.svg", name: "EMS League", group: "script" },
  { file: "EMSQwandry.svg", name: "EMS Qwandry", group: "script" },
  { file: "EMSFelix.svg", name: "EMS Felix", group: "script" },
  { file: "EMSLittlePrincess.svg", name: "EMS Little Princess", group: "script" },
  { file: "HersheyScript1.svg", name: "Hershey Script", group: "script" },
  { file: "HersheyScriptMed.svg", name: "Hershey Script Medium", group: "script" },
  { file: "EMSReadability.svg", name: "EMS Readability", group: "print" },
  { file: "EMSReadabilityItalic.svg", name: "EMS Readability Italic", group: "print" },
  { file: "EMSNixish.svg", name: "EMS Nixish", group: "print" },
  { file: "EMSNixishItalic.svg", name: "EMS Nixish Italic", group: "print" },
  { file: "EMSHerculean.svg", name: "EMS Herculean", group: "print" },
  { file: "EMSOsmotron.svg", name: "EMS Osmotron", group: "print" },
  { file: "EMSElfin.svg", name: "EMS Elfin", group: "print" },
  { file: "EMSMistyNight.svg", name: "EMS Misty Night", group: "print" },
  { file: "EMSSpaceRocks.svg", name: "EMS SpaceRocks (Asteroids)", group: "print" },
  { file: "TwinSans.svg", name: "Twin Sans", group: "print" },
  { file: "HersheySans1.svg", name: "Hershey Sans", group: "print" },
  { file: "HersheySansMed.svg", name: "Hershey Sans Medium", group: "print" },
  { file: "HersheySerifMed.svg", name: "Hershey Serif", group: "print" },
  { file: "HersheySerifMedItalic.svg", name: "Hershey Serif Italic", group: "print" },
  { file: "HersheySerifBold.svg", name: "Hershey Serif Bold", group: "print" },
  { file: "HersheySerifBoldItalic.svg", name: "Hershey Serif Bold Italic", group: "print" },
  { file: "HersheyGothEnglish.svg", name: "Hershey Gothic English", group: "print" },
  { file: "HersheyGothGerman.svg", name: "Hershey Gothic German", group: "print" },
  { file: "HersheyGothItalian.svg", name: "Hershey Gothic Italian", group: "print" },
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
  /**
   * Traced fonts only: "line" = one pen line through each letter; "filled" =
   * the letters' outlines (filled with the item's hatch fill).
   */
  style?: "line" | "filled";
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

/**
 * Glyph paths (font units, y up): absolute M, L, C (cubic curves, flattened)
 * and Z, with implicit repeats, as used by the Hershey and EMS SVG fonts.
 */
export function parseStrokes(d: string): Stroke[] {
  const strokes: Stroke[] = [];
  let current: Stroke | null = null;
  let start: [number, number] = [0, 0];
  const tokens = d.match(/[MLCZmlcz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0;
  let cmd = "";
  const num = () => Number(tokens[i++]);
  const isNum = () => i < tokens.length && !/^[MLCZmlcz]$/.test(tokens[i]);
  const finish = () => {
    if (current && current.length > 1) strokes.push(current);
    current = null;
  };
  while (i < tokens.length) {
    if (!isNum()) cmd = tokens[i++].toUpperCase();
    if (cmd === "M") {
      finish();
      start = [num(), num()];
      current = [start];
      cmd = "L"; // further pairs are line-tos
    } else if (cmd === "L") {
      current?.push([num(), num()]);
    } else if (cmd === "C") {
      const p0: [number, number] = current?.[current.length - 1] ?? start;
      const c1: [number, number] = [num(), num()];
      const c2: [number, number] = [num(), num()];
      const p3: [number, number] = [num(), num()];
      for (let k = 1; k <= 8; k++) {
        const t = k / 8;
        const a = (1 - t) ** 3;
        const b = 3 * (1 - t) ** 2 * t;
        const c = 3 * (1 - t) * t * t;
        const e = t ** 3;
        current?.push([a * p0[0] + b * c1[0] + c * c2[0] + e * p3[0], a * p0[1] + b * c1[1] + c * c2[1] + e * p3[1]]);
      }
    } else if (cmd === "Z") {
      current?.push(start);
      finish();
    } else {
      i++; // unknown token: skip
    }
  }
  finish();
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
  // The box hugs the letters actually used: from the tallest letter of the
  // first line (at least a capital) to the lowest of the last (at least the
  // font's descent), so a few unusually tall glyphs don't pad every text.
  const yRange = (line: string) => {
    let hi = Number.NEGATIVE_INFINITY;
    let lo = Number.POSITIVE_INFINITY;
    for (const ch of line) {
      for (const st of font.glyphs.get(ch)?.strokes ?? []) {
        for (const [, y] of st) {
          if (y > hi) hi = y;
          if (y < lo) lo = y;
        }
      }
    }
    return { hi, lo };
  };
  const top = Math.max(font.capHeight, yRange(lines[0]).hi);
  const bottom = Math.min(font.descent, yRange(lines[lines.length - 1]).lo);
  const paths: Path[] = [];
  lines.forEach((line, i) => {
    const baseline = top + i * lineHeight;
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
  const height = top - bottom + (lines.length - 1) * lineHeight;
  return { paths, width: Math.max(boxWidth * k, t.sizeMm * 0.5), height: height * k };
}

/** Characters the font can't draw (e.g. Arabic in these Latin fonts). */
export function missingCharacters(font: SingleLineFont, text: string): string[] {
  const missing = new Set<string>();
  for (const ch of text) if (!/\s/.test(ch) && !font.glyphs.has(ch)) missing.add(ch);
  return [...missing];
}

export const textJobKey = (t: TextInfo) =>
  JSON.stringify([t.text, t.font, t.sizeMm, t.letterSpacing, t.lineSpacing, t.align, t.style ?? "line"]);
