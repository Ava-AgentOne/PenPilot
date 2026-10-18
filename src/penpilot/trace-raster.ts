/**
 * Raster helpers for PenPilot's tracer: distance transform, blob finding and
 * boundary tracing. Used to draw thick parts of letters (the solid heads of
 * Arabic و ف ق م ه in Ruqʿah, say) as small loops, the way they're written by
 * hand, instead of thinning them to a stub.
 */

import type { Pt } from "./trace-geometry.js";

/** Distance (px) from every ink pixel to the nearest paper pixel (two-pass chamfer 1 / √2). */
export function distanceTransform(dark: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = dark[i] ? INF : 0;
  const s2 = Math.SQRT2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) {
        v = Math.min(v, d[i - w] + 1);
        if (x > 0) v = Math.min(v, d[i - w - 1] + s2);
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + s2);
      }
      d[i] = v;
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x < w - 1) v = Math.min(v, d[i + 1] + 1);
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 1);
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + s2);
        if (x > 0) v = Math.min(v, d[i + w - 1] + s2);
      }
      d[i] = v;
    }
  }
  return d;
}

/** Typical stroke half-width: the median distance along the strokes' ridges. */
export function strokeHalfWidth(d: Float32Array, w: number, h: number): number {
  const ridge: number[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const v = d[i];
      if (v < 1) continue;
      if (
        v >= d[i - 1] &&
        v >= d[i + 1] &&
        v >= d[i - w] &&
        v >= d[i + w] &&
        v >= d[i - w - 1] &&
        v >= d[i - w + 1] &&
        v >= d[i + w - 1] &&
        v >= d[i + w + 1]
      )
        ridge.push(v);
    }
  }
  if (ridge.length === 0) return 0;
  ridge.sort((a, b) => a - b);
  return ridge[Math.floor(ridge.length / 2)];
}

/**
 * Trace the outer boundary of every blob in `mask` (Moore-neighbour tracing),
 * as closed loops through pixel centres.
 */
export function blobOutlines(mask: Uint8Array, w: number, h: number, minPixels = 6): Pt[][] {
  const seen = new Uint8Array(w * h);
  const loops: Pt[][] = [];
  // Clockwise neighbours, starting west.
  const dx = [-1, -1, 0, 1, 1, 1, 0, -1];
  const dy = [0, -1, -1, -1, 0, 1, 1, 1];
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || seen[start]) continue;
    // Mark the whole blob (and count it).
    let count = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop() as number;
      count++;
      const x = i % w;
      const y = (i - x) / w;
      for (let k = 0; k < 8; k++) {
        const nx = x + dx[k];
        const ny = y + dy[k];
        if (at(nx, ny) && !seen[ny * w + nx]) {
          seen[ny * w + nx] = 1;
          stack.push(ny * w + nx);
        }
      }
    }
    if (count < minPixels) continue;
    // `start` is the blob's first pixel in scan order: its west neighbour is empty.
    const sx = start % w;
    const sy = (start - sx) / w;
    const loop: Pt[] = [[sx, sy]];
    let cx = sx;
    let cy = sy;
    let dir = 0; // we arrived from the west
    for (let steps = 0; steps < 4 * count + 16; steps++) {
      let found = false;
      for (let k = 0; k < 8; k++) {
        const nd = (dir + 6 + k) % 8; // start looking just "behind" the last move
        const nx = cx + dx[nd];
        const ny = cy + dy[nd];
        if (at(nx, ny)) {
          cx = nx;
          cy = ny;
          dir = nd;
          found = true;
          break;
        }
      }
      if (!found || (cx === sx && cy === sy)) break;
      loop.push([cx, cy]);
    }
    if (loop.length > 2) {
      loop.push([sx, sy]);
      loops.push(loop);
    }
  }
  return loops;
}

/**
 * Thick parts: where the ink is much thicker than the typical stroke (a solid
 * letter head), return
 * - `area`: the inside of each thick part (centre lines there are dropped), and
 * - `loops`: its boundary, a closed pen line about a stroke's half-width in from
 *   the ink edge -- so a solid head is drawn as a small loop, as by hand.
 * Found by growing from the thickest points through ink thicker than the
 * normal stroke; thin strokes attached to the head are left to the centre lines.
 */
export function thickParts(
  dark: Uint8Array,
  w: number,
  h: number,
  ratio = 1.8,
): { area: Uint8Array; loops: Pt[][]; halfWidth: number } {
  const d = distanceTransform(dark, w, h);
  const hw = strokeHalfWidth(d, w, h);
  const area = new Uint8Array(w * h);
  if (hw <= 0) return { area, loops: [], halfWidth: hw };
  const seed = Math.max(2.5, ratio * hw);
  const grow = 1.2 * hw;
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (d[i] > seed && !area[i]) {
      area[i] = 1;
      stack.push(i);
      while (stack.length) {
        const j = stack.pop() as number;
        const x = j % w;
        const y = (j - x) / w;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const k = ny * w + nx;
            if (!area[k] && d[k] > grow) {
              area[k] = 1;
              stack.push(k);
            }
          }
        }
      }
    }
  }
  return { area, loops: blobOutlines(area, w, h), halfWidth: hw };
}
