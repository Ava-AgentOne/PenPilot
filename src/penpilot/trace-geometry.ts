/** Polyline helpers for PenPilot's tracer (trace-worker.ts), kept apart so they can be tested. */

export type Pt = [number, number];

/** skeleton-tracing works in tiles; join pieces whose ends meet. */
export function joinEnds(lines: Pt[][], tol: number): Pt[][] {
  const pool = lines.filter((l) => l.length > 1).map((l) => l.slice());
  const close = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const a = pool[i];
        const b = pool[j];
        let joined: Pt[] | null = null;
        if (close(a[a.length - 1], b[0])) joined = a.concat(b.slice(1));
        else if (close(a[a.length - 1], b[b.length - 1])) joined = a.concat(b.slice(0, -1).reverse());
        else if (close(a[0], b[b.length - 1])) joined = b.concat(a.slice(1));
        else if (close(a[0], b[0])) joined = b.slice().reverse().concat(a.slice(1));
        if (joined) {
          pool[i] = joined;
          pool.splice(j, 1);
          merged = true;
          j--;
        }
      }
    }
  }
  return pool;
}

export function length(l: Pt[]): number {
  let s = 0;
  for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
  return s;
}

/** Ramer–Douglas–Peucker: drop points within `tol` px of the line. */
export function simplify(l: Pt[], tol: number): Pt[] {
  if (tol <= 0 || l.length < 3) return l;
  const keep = new Uint8Array(l.length);
  keep[0] = keep[l.length - 1] = 1;
  const stack: [number, number][] = [[0, l.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop() as [number, number];
    const [ax, ay] = l[a];
    const [bx, by] = l[b];
    const len = Math.hypot(bx - ax, by - ay);
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      // Closed loops start and end on the same point: measure from that point.
      const d =
        len < 1e-9
          ? Math.hypot(l[i][0] - ax, l[i][1] - ay)
          : Math.abs((by - ay) * l[i][0] - (bx - ax) * l[i][1] + bx * ay - by * ax) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tol) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return l.filter((_p, i) => keep[i]);
}

/** Chaikin corner cutting, keeping the end points (and closed loops closed). */
export function smooth(l: Pt[], rounds: number): Pt[] {
  let pts = l;
  for (let r = 0; r < rounds && pts.length > 2; r++) {
    const closed = pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
    const next: Pt[] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      next.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    next.push(closed ? next[1] : pts[pts.length - 1]);
    if (closed) next.shift();
    pts = next;
  }
  return pts;
}

export function toPathData(lines: Pt[][]): string {
  let d = "";
  for (const l of lines) {
    d += ` M${l[0][0].toFixed(2)},${l[0][1].toFixed(2)}`;
    for (let i = 1; i < l.length; i++) d += `L${l[i][0].toFixed(2)},${l[i][1].toFixed(2)}`;
  }
  return d;
}

/** Split a line wherever it passes through `inside`, keeping the parts outside. */
export function cutOut(l: Pt[], inside: (x: number, y: number) => boolean): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  for (const p of l) {
    if (inside(p[0], p[1])) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

/**
 * Remove specks and stray hairs, but never a short piece that links two parts
 * of a letter: a line shorter than `min` is dropped only if one or both of its
 * ends touch nothing else (within `tol` px).
 */
export function dropSpecks(lines: Pt[][], min: number, tol = 2.5): Pt[][] {
  if (min <= 0) return lines;
  const ends = lines.map((l) => [l[0], l[l.length - 1]] as const);
  const touches = (p: Pt, self: number) =>
    lines.some((l, j) => {
      if (j === self) return false;
      for (const q of l) if (Math.abs(q[0] - p[0]) <= tol && Math.abs(q[1] - p[1]) <= tol) return true;
      return false;
    });
  return lines.filter((l, i) => {
    if (length(l) >= min) return true;
    return touches(ends[i][0], i) && touches(ends[i][1], i);
  });
}
