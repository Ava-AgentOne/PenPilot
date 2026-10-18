/**
 * PenPilot: a plan's drawn lines and pens -- counting the lines, finding which
 * pen draws which part, and building the rest of a plot so it can continue
 * from a chosen line after a stop (e.g. when a pen ran dry).
 */

import {
  constantAccelerationPlan,
  Device,
  PenChange,
  PenMotion,
  Plan,
  type PlanOptions,
  XYMotion,
} from "../planning.js";

/** Motion indices of the pen-down moves -- the lines that get drawn -- in order. */
export function drawnLines(plan: Plan): number[] {
  const out: number[] = [];
  let down = false; // plans go: travel, pen down, draw, pen up, travel, ...
  plan.motions.forEach((m, i) => {
    if (m instanceof PenChange) down = false;
    else if (m instanceof PenMotion) down = !down;
    else if (down) out.push(i);
  });
  return out;
}

/**
 * One plot from each pen's own plan, in order: a pen-change marker before each
 * part (the plot stops at all but the first). Pens with nothing to draw are left out.
 */
export function joinPenPlans(parts: { penId: string; penUpPos: number; plan: Plan }[]): Plan {
  const motions: (XYMotion | PenMotion | PenChange)[] = [];
  for (const part of parts) {
    if (!part.plan.motions.some((x) => x instanceof PenMotion)) continue; // nothing for this pen to draw
    motions.push(new PenChange(part.penId, part.penUpPos, motions.length > 0), ...part.plan.motions);
  }
  return new Plan(motions);
}

/** How many of `lines` (motion indices, ascending) are below `idx`. */
export function countBelow(lines: number[], idx: number): number {
  let lo = 0;
  let hi = lines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid] < idx) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface PenPart {
  penId: string;
  /** Pen-up servo position for this pen. */
  penUpPos: number;
  /** Motion index of its pen-change marker. */
  start: number;
  /** Whether the plot stops here for the pen to be put in. */
  wait: boolean;
}

/** The plan's parts, one per pen, in plotting order (empty for plans without pens, e.g. Frame). */
export function penParts(plan: Plan): PenPart[] {
  const out: PenPart[] = [];
  plan.motions.forEach((m, i) => {
    if (m instanceof PenChange) out.push({ penId: m.penId, penUpPos: m.penUpPos, start: i, wait: m.wait });
  });
  return out;
}

/** The part of `parts` that motion `idx` belongs to. */
export function partAt(parts: PenPart[], idx: number): PenPart | null {
  let found: PenPart | null = null;
  for (const p of parts) if (p.start <= idx) found = p;
  return found;
}

export interface ContinuedPlot {
  plan: Plan;
  /** Maps a motion index of `plan` to the matching index of the full plan. */
  toFull: (i: number) => number;
}

/**
 * The rest of `plan` from line `from` (0-based): drive from the home corner to
 * the start of that line, then everything after it as planned. When that line
 * belongs to another pen than `penInPlotter`, it first stops for that pen.
 */
export function continuePlan(
  plan: Plan,
  from: number,
  options: PlanOptions,
  penInPlotter: string | null,
): ContinuedPlot | null {
  const lines = drawnLines(plan);
  if (from < 0 || from >= lines.length) return null;
  const drawIdx = lines[from];
  const draw = plan.motions[drawIdx];
  const down = plan.motions[drawIdx - 1];
  const before = plan.motions[drawIdx - 2];
  if (!(draw instanceof XYMotion) || !(down instanceof PenMotion) || !(before instanceof XYMotion)) return null;
  const firstMove = plan.motions.find((m): m is XYMotion => m instanceof XYMotion);
  const home = firstMove?.p1 ?? { x: 0, y: 0 };
  const spm = Device(options.hardware).stepsPerMm;
  const travel = constantAccelerationPlan([home, draw.p1], {
    acceleration: options.penUpAcceleration * spm,
    maximumVelocity: options.penUpMaxVelocity * spm,
    corneringFactor: 0,
  });
  const part = partAt(penParts(plan), drawIdx);
  const prefix: (XYMotion | PenMotion | PenChange)[] = [];
  if (part) prefix.push(new PenChange(part.penId, part.penUpPos, penInPlotter !== part.penId));
  prefix.push(travel);
  const downIdx = drawIdx - 1;
  return {
    plan: new Plan(prefix.concat(plan.motions.slice(downIdx))),
    // The lead-in shows as the travel to that line, so everything before it reads as done.
    toFull: (i) => (i < prefix.length ? drawIdx - 2 : downIdx + (i - prefix.length)),
  };
}
