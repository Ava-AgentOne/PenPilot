/**
 * PenPilot photos: turn a picture into pen lines with Plotterfun's styles
 * (vendor/plotterfun, run unchanged as Web Workers, see its SOURCE.md).
 */

import type { Path } from "flatten-svg";

/** Plotterfun's styles, in its own menu order, with its names. */
export const PHOTO_STYLES: { file: string; name: string }[] = [
  { file: "squiggle.js", name: "Squiggle" },
  { file: "squiggleLeftRight.js", name: "Squiggle Left/Right" },
  { file: "spiral.js", name: "Spiral" },
  { file: "polyspiral.js", name: "Polygon Spiral" },
  { file: "sawtooth.js", name: "Sawtooth" },
  { file: "stipple.js", name: "Stipples" },
  { file: "delaunay.js", name: "Delaunay" },
  { file: "linedraw.js", name: "Linedraw" },
  { file: "mosaic.js", name: "Mosaic" },
  { file: "subline.js", name: "Subline" },
  { file: "springs.js", name: "Springs" },
  { file: "waves.js", name: "Waves" },
  { file: "needles.js", name: "Needles" },
  { file: "implode.js", name: "Implode" },
  { file: "halftone.js", name: "Halftone" },
  { file: "boxes.js", name: "Boxes" },
  { file: "dots.js", name: "Dots" },
  { file: "jaggy.js", name: "Jaggy" },
  { file: "longwave.js", name: "Longwave" },
  { file: "linescan.js", name: "Linescan" },
  { file: "woven.js", name: "Woven" },
  { file: "peano.js", name: "Peano" },
  { file: "margins.js", name: "Margins" },
];

export const DEFAULT_STYLE = "squiggle.js";
/** Longest side of the picture the style works on, px (Plotterfun's page uses 800). */
export const DEFAULT_DETAIL = 800;
export const MIN_DETAIL = 200;
export const MAX_DETAIL = 1600;

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"];
export const isImageFile = (f: File) => IMAGE_TYPES.includes(f.type) || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name);

/** A slider, tick-box or list, as a style declares it. */
export interface PhotoControl {
  label: string;
  type?: "range" | "checkbox" | "select";
  value?: number | string | boolean;
  /** Tick-boxes may give their default as `checked` (Plotterfun copies the control onto an <input>). */
  checked?: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  noRestart?: boolean;
}

export type PhotoConfig = Record<string, number | string | boolean>;

export interface PhotoInfo {
  /** The picture as loaded; redrawn at `detail` for the style. */
  bitmap: ImageBitmap;
  /** For showing the picture faintly behind its lines. */
  previewUrl: string;
  style: string;
  detail: number;
  /** Size of the picture the style works on, px (also the item's bounds). */
  width: number;
  height: number;
  /** The style's controls (from the worker) and their values. */
  controls: PhotoControl[];
  config: PhotoConfig;
  status: "working" | "done" | "error";
  message: string;
}

/** The working picture size for a given detail (longest side = detail). */
export function rasterSize(
  bitmap: { width: number; height: number },
  detail: number,
): { width: number; height: number } {
  const k = detail / Math.max(bitmap.width, bitmap.height);
  return { width: Math.max(1, Math.round(bitmap.width * k)), height: Math.max(1, Math.round(bitmap.height * k)) };
}

export function rasterise(bitmap: ImageBitmap, width: number, height: number): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  // Transparent areas (e.g. PNG logos) count as white paper.
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

/**
 * Plotterfun's results as lines. Its styles only ever produce
 * "M x,y L x,y ..." polylines (postLines) or tiny circles
 * "M x,y-r a r r 0 1 0 0.001 0Z" (postCircles), which become small polygons.
 */
type Pt = { x: number; y: number };

export function parsePlotterfunPath(d: string): Path[] {
  const paths: Path[] = [];
  let current: Pt[] | null = null;
  const flush = () => {
    if (current && current.length > 1) paths.push({ stroke: "black", groupId: "", points: current });
    current = null;
  };
  const re = /([MLaZ])([^MLaZ]*)/g;
  let m: RegExpExecArray | null;
  for (m = re.exec(d); m !== null; m = re.exec(d)) {
    const nums = m[2]
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    switch (m[1]) {
      case "M":
        flush();
        current = [{ x: nums[0], y: nums[1] }];
        break;
      case "L":
        current?.push({ x: nums[0], y: nums[1] });
        break;
      case "a": {
        // A full circle drawn from its top point: centre is one radius below.
        const start: Pt | undefined = current?.[current.length - 1];
        if (!start) break;
        const r = Math.max(nums[0], 0.05);
        const cx: number = start.x;
        const cy: number = start.y + r;
        const n = Math.max(6, Math.min(24, Math.round(r * 6)));
        const ring: Pt[] = [];
        for (let i = 0; i <= n; i++) {
          const t = (i / n) * 2 * Math.PI;
          ring.push({ x: cx + r * Math.sin(t), y: cy - r * Math.cos(t) });
        }
        current = ring;
        break;
      }
      case "Z":
        flush();
        break;
    }
  }
  flush();
  return paths;
}

/** Fill in any control the config doesn't have yet with the style's default. */
export function withDefaults(controls: PhotoControl[], config: PhotoConfig): PhotoConfig {
  const out: PhotoConfig = { ...config };
  for (const c of controls) {
    if (out[c.label] !== undefined) continue;
    out[c.label] =
      c.type === "checkbox"
        ? (c.checked ?? !!c.value)
        : (c.value ?? (c.type === "select" ? (c.options?.[0] ?? "") : (c.min ?? 0)));
  }
  return out;
}

export interface PhotoJob {
  cancel(): void;
}

/**
 * Run one style on a picture. `onControls` fires once with the style's
 * controls and the complete config actually used; `onLines` fires with each
 * (possibly improving) result; `onMessage` with progress text.
 */
export function runPhotoStyle(
  style: string,
  config: PhotoConfig,
  image: ImageData,
  handlers: {
    onControls(controls: PhotoControl[], fullConfig: PhotoConfig): void;
    onLines(paths: Path[]): void;
    onMessage(text: string): void;
    onError(text: string): void;
  },
): PhotoJob {
  const worker = new Worker(`plotterfun/${style}`);
  let cancelled = false;
  worker.onmessage = (e: MessageEvent) => {
    if (cancelled) return;
    const [type, data] = e.data as [string, unknown];
    if (type === "sliders") {
      const controls = data as PhotoControl[];
      const full = withDefaults(controls, config);
      handlers.onControls(controls, full);
      worker.postMessage([{ ...full, width: image.width, height: image.height }, image]);
    } else if (type === "svg-path") {
      handlers.onLines(parsePlotterfunPath(data as string));
    } else if (type === "msg") {
      handlers.onMessage(String(data ?? ""));
    }
  };
  worker.onerror = (e) => {
    if (!cancelled) handlers.onError(e.message || "This style failed on this picture.");
  };
  return {
    cancel() {
      cancelled = true;
      worker.terminate();
    },
  };
}

/** Stable key for "what would be drawn", to know when to redraw. */
export function photoJobKey(p: Pick<PhotoInfo, "style" | "detail" | "config">): string {
  return JSON.stringify([p.style, p.detail, Object.entries(p.config).sort()]);
}
