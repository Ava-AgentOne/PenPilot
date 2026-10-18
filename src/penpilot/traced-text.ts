/**
 * Text in ordinary fonts -- Arabic, or extra handwriting fonts -- written as
 * single pen strokes: render the text with the browser (which handles Arabic
 * letter joining, right-to-left order and dots), then trace its centre lines
 * with PenPilot's tracer (trace-worker.ts), keeping dots as small pen circles.
 *
 * Fonts are bundled from @fontsource packages (SIL OFL; Homemade Apple is
 * Apache 2.0), so this works offline. They only download into memory when used.
 */

import "@fontsource/alkalami/400.css";
import "@fontsource/amiri/400.css";
import "@fontsource/noto-naskh-arabic/400.css";
import "@fontsource/lateef/400.css";
import "@fontsource/reem-kufi/400.css";
import "@fontsource/tajawal/400.css";
import "@fontsource/caveat/400.css";
import "@fontsource/dancing-script/400.css";
import "@fontsource/kalam/400.css";
import "@fontsource/homemade-apple/400.css";
import "@fontsource/indie-flower/400.css";

export const TRACED_PREFIX = "traced:";

export const TRACED_FONTS: { id: string; family: string; name: string; arabic: boolean }[] = [
  { id: "traced:alkalami", family: "Alkalami", name: "Alkalami: handwritten", arabic: true },
  { id: "traced:noto-naskh", family: "Noto Naskh Arabic", name: "Noto Naskh: clear Naskh", arabic: true },
  { id: "traced:amiri", family: "Amiri", name: "Amiri: classic Naskh", arabic: true },
  { id: "traced:lateef", family: "Lateef", name: "Lateef: Naskh", arabic: true },
  { id: "traced:reem-kufi", family: "Reem Kufi", name: "Reem Kufi: Kufi", arabic: true },
  { id: "traced:tajawal", family: "Tajawal", name: "Tajawal: modern", arabic: true },
  { id: "traced:caveat", family: "Caveat", name: "Caveat: handwriting", arabic: false },
  { id: "traced:dancing-script", family: "Dancing Script", name: "Dancing Script", arabic: false },
  { id: "traced:kalam", family: "Kalam", name: "Kalam: handwriting", arabic: false },
  { id: "traced:homemade-apple", family: "Homemade Apple", name: "Homemade Apple: handwriting", arabic: false },
  { id: "traced:indie-flower", family: "Indie Flower", name: "Indie Flower: handwriting", arabic: false },
];

export const isTracedFont = (font: string) => font.startsWith(TRACED_PREFIX);
export const tracedFont = (font: string) => TRACED_FONTS.find((f) => f.id === font);

const RTL = /[֐-ࣿיִ-﷿ﹰ-﻿]/;

/** Font size the text is drawn at before tracing (px): big enough for clean centre lines. */
const DRAW_PX = 180;

export interface TracedTextImage {
  image: ImageData;
  /** mm per pixel of `image`, so that the letter size matches `sizeMm`. */
  mmPerPx: number;
  /** Tracer settings suited to this drawing size. */
  traceConfig: Record<string, number | boolean>;
}

export async function renderTracedText(
  family: string,
  text: string,
  sizeMm: number,
  letterSpacing: number,
  lineSpacing: number,
  align: "left" | "centre" | "right",
): Promise<TracedTextImage> {
  const font = `${DRAW_PX}px "${family}"`;
  await document.fonts.load(font, text || "H");
  const rtl = RTL.test(text);
  const ctx = document.createElement("canvas").getContext("2d") as CanvasRenderingContext2D;
  ctx.font = font;
  // Letter size: height of a capital "H", or of the Arabic alef for Arabic text.
  const ref = ctx.measureText(rtl ? "ا" : "H");
  const refPx = Math.max(1, ref.actualBoundingBoxAscent + Math.min(0, ref.actualBoundingBoxDescent));
  // Arabic letters can't be spaced apart without breaking their joins.
  const spacingPx = rtl ? 0 : letterSpacing * refPx;
  ctx.letterSpacing = `${spacingPx}px`;

  const lines = text.split(/\r?\n/);
  const metrics = lines.map((l) => ctx.measureText(l || " "));
  const ascent = Math.max(...metrics.map((m) => m.fontBoundingBoxAscent || DRAW_PX));
  const descent = Math.max(...metrics.map((m) => m.fontBoundingBoxDescent || DRAW_PX * 0.3));
  const lineHeight = (ascent + descent) * lineSpacing;
  const textWidth = Math.max(...metrics.map((m) => m.width), 1);
  const pad = Math.round(DRAW_PX * 0.25);

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(textWidth + 2 * pad);
  canvas.height = Math.ceil(ascent + descent + (lines.length - 1) * lineHeight + 2 * pad);
  const g = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  g.fillStyle = "white";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "black";
  g.font = font;
  g.letterSpacing = `${spacingPx}px`;
  g.direction = rtl ? "rtl" : "ltr";
  g.textBaseline = "alphabetic";
  g.textAlign = align === "centre" ? "center" : align;
  const x = align === "left" ? pad : align === "right" ? canvas.width - pad : canvas.width / 2;
  lines.forEach((line, i) => {
    g.fillText(line, x, pad + ascent + i * lineHeight);
  });

  return {
    image: g.getImageData(0, 0, canvas.width, canvas.height),
    mmPerPx: sizeMm / refPx,
    traceConfig: {
      Threshold: 128,
      Inverted: false,
      Blur: 1,
      "Remove specks": DRAW_PX * 0.05,
      Simplify: 0.8,
      Smoothing: 2,
      Dots: DRAW_PX * 0.22,
    },
  };
}
