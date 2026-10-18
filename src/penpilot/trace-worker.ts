/**
 * PenPilot's image tracer, run as a Web Worker with the same message protocol
 * as Plotterfun's styles (see photo.ts):
 *   -> ['sliders', controls]           when loaded
 *   <- [config, imageData]             config.Mode is "centre" or "outline"
 *   -> ['msg', text] / ['svg-path', d] progress and result ("M x,y L x,y ...")
 *
 * - Centre lines: one pen stroke down the middle of every dark line
 *   (skeleton-tracing by Lingdong Huang, MIT). Best for line art on a plotter.
 * - Outlines: the edges of every dark shape (imagetracerjs, public domain),
 *   like a typical "image trace". A pen draws both edges of each line.
 */

import ImageTracer from "imagetracerjs";
import TraceSkeleton from "skeleton-tracing-js";
import { joinEnds, length, type Pt, simplify, smooth, toPathData } from "./trace-geometry.js";

const controls = [
  { label: "Threshold", value: 128, min: 1, max: 254 },
  { label: "Inverted", type: "checkbox", checked: false },
  { label: "Blur", value: 1, min: 0, max: 4 },
  { label: "Remove specks", value: 12, min: 0, max: 200 },
  { label: "Simplify", value: 0.8, min: 0, max: 4, step: 0.1 },
  { label: "Smoothing", value: 2, min: 0, max: 4 },
];

// Worker scope: postMessage takes just the message.
const post = (msg: unknown) => (self as unknown as { postMessage(m: unknown): void }).postMessage(msg);

post(["sliders", controls]);

self.onmessage = (e: MessageEvent) => {
  const [config, image] = e.data as [Record<string, number | string | boolean>, ImageData];
  if (!image) return;
  try {
    post(["msg", "Tracing…"]);
    const dark = binarise(image, Number(config.Threshold), Boolean(config.Inverted), Number(config.Blur));
    const lines =
      config.Mode === "outline"
        ? traceOutlines(dark, image.width, image.height)
        : traceCentreLines(dark, image.width, image.height);
    const cleaned = lines
      .filter((l) => length(l) >= Number(config["Remove specks"]))
      .map((l) => smooth(simplify(l, Number(config.Simplify)), Number(config.Smoothing)))
      .filter((l) => l.length > 1);
    post(["svg-path", toPathData(cleaned)]);
    post(["msg", "Done"]);
  } catch (err) {
    // Surfaces as the worker's error event (shown in the photo panel).
    setTimeout(() => {
      throw err;
    });
  }
};

/** 1 = ink (dark), 0 = paper. Optional box blur first, to calm JPEG noise. */
function binarise(img: ImageData, threshold: number, inverted: boolean, blur: number): Uint8Array {
  const { width: w, height: h, data } = img;
  let lum: Float32Array<ArrayBufferLike> = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = 0.2126 * data[4 * i] + 0.7152 * data[4 * i + 1] + 0.0722 * data[4 * i + 2];
  if (blur > 0) lum = boxBlur(lum, w, h, Math.round(blur));
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = lum[i] < threshold !== inverted ? 1 : 0;
  // Keep a one-pixel paper border, so shapes touching the edge close up.
  for (let x = 0; x < w; x++) out[x] = out[(h - 1) * w + x] = 0;
  for (let y = 0; y < h; y++) out[y * w] = out[y * w + w - 1] = 0;
  return out;
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const xx = x + k;
        if (xx >= 0 && xx < w) {
          s += src[y * w + xx];
          n++;
        }
      }
      tmp[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let k = -r; k <= r; k++) {
        const yy = y + k;
        if (yy >= 0 && yy < h) {
          s += tmp[yy * w + x];
          n++;
        }
      }
      out[y * w + x] = s / n;
    }
  }
  return out;
}

function traceCentreLines(dark: Uint8Array, w: number, h: number): Pt[][] {
  const result = TraceSkeleton.fromBoolArray(dark, w, h) as { polylines: Pt[][] };
  return joinEnds(result.polylines, 1.5);
}

function traceOutlines(dark: Uint8Array, w: number, h: number): Pt[][] {
  // Feed the black/white picture to imagetracerjs with a fixed 2-colour palette.
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = dark[i] ? 0 : 255;
    rgba[4 * i] = rgba[4 * i + 1] = rgba[4 * i + 2] = v;
    rgba[4 * i + 3] = 255;
  }
  const td = ImageTracer.imagedataToTracedata(
    { width: w, height: h, data: rgba },
    {
      ltres: 1,
      qtres: 1,
      pathomit: 4,
      rightangleenhance: false,
      colorsampling: 0,
      numberofcolors: 2,
      colorquantcycles: 1,
      blurradius: 0,
      pal: [
        { r: 0, g: 0, b: 0, a: 255 },
        { r: 255, g: 255, b: 255, a: 255 },
      ],
    },
  ) as TraceData;
  const out: Pt[][] = [];
  td.layers.forEach((layer, i) => {
    const c = td.palette[i];
    if (c.r + c.g + c.b > 3 * 128) return; // only the ink layer
    for (const path of layer) {
      const pts: Pt[] = [];
      for (const s of path.segments) {
        if (pts.length === 0) pts.push([s.x1, s.y1]);
        if (s.type === "Q" && s.x3 !== undefined && s.y3 !== undefined) {
          for (let k = 1; k <= 6; k++) {
            const t = k / 6;
            const a = (1 - t) * (1 - t);
            const b = 2 * (1 - t) * t;
            const c2 = t * t;
            pts.push([a * s.x1 + b * s.x2 + c2 * s.x3, a * s.y1 + b * s.y2 + c2 * s.y3]);
          }
        } else {
          pts.push([s.x2, s.y2]);
        }
      }
      if (pts.length > 1) {
        const [fx, fy] = pts[0];
        const [lx, ly] = pts[pts.length - 1];
        if (fx !== lx || fy !== ly) pts.push([fx, fy]); // outlines are closed
        out.push(pts);
      }
    }
  });
  return out;
}

interface TraceData {
  layers: {
    segments: { type: string; x1: number; y1: number; x2: number; y2: number; x3?: number; y3?: number }[];
  }[][];
  palette: { r: number; g: number; b: number }[];
}
