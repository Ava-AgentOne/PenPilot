/**
 * PenPilot's pens: the pens you own, each with its own pen heights, drawing
 * speed, line width and colour, saved on this computer. Every drawing on the
 * page is drawn with one of them; a page that uses several is plotted one pen
 * at a time, stopping for you to put in the next (see plot-job.ts).
 */

import { Device, type Plan, type PlanOptions, plan } from "../planning.js";
import type { Vec2 } from "../vec.js";

export interface Pen {
  id: string;
  name: string;
  /** Colour shown on screen, "#rrggbb". */
  colour: string;
  /** Pen-lift positions, % (0-100, as in saxi). */
  upHeight: number;
  downHeight: number;
  /** Drawing speed (pen down), mm/s. */
  speed: number;
  /** Width of the line it draws, mm. */
  widthMm: number;
}

const PENS_KEY = "penpilot.pens";
const SELECTED_KEY = "penpilot.pen";

/** Colours offered for new pens, in turn. */
export const PEN_COLOURS = ["#222222", "#1f5fbf", "#c62828", "#2e7d32", "#ef6c00", "#6a1b9a", "#00838f", "#ad1457"];

let nextId = 1;
const newId = () => `pen-${Date.now().toString(36)}-${nextId++}`;

/** The first pen, made from the pen settings the app had before pens existed. */
export function firstPen(options: PlanOptions): Pen {
  return {
    id: newId(),
    name: "My pen",
    colour: PEN_COLOURS[0],
    upHeight: options.penUpHeight,
    downHeight: options.penDownHeight,
    speed: options.penDownMaxVelocity,
    widthMm: 0.5,
  };
}

const clamp = (v: unknown, lo: number, hi: number, dflt: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;

/** A pen read from storage (or a project file), with any missing or odd values made safe. */
export function cleanPen(p: Partial<Pen>, fallback: Pen): Pen {
  return {
    id: typeof p.id === "string" && p.id ? p.id : newId(),
    name: typeof p.name === "string" && p.name.trim() ? p.name : fallback.name,
    colour: typeof p.colour === "string" && /^#[0-9a-f]{6}$/i.test(p.colour) ? p.colour : fallback.colour,
    upHeight: clamp(p.upHeight, 0, 100, fallback.upHeight),
    downHeight: clamp(p.downHeight, 0, 100, fallback.downHeight),
    speed: clamp(p.speed, 1, 500, fallback.speed),
    widthMm: clamp(p.widthMm, 0.05, 10, fallback.widthMm),
  };
}

export function loadPens(options: PlanOptions): Pen[] {
  const fallback = firstPen(options);
  try {
    const raw = JSON.parse(window.localStorage.getItem(PENS_KEY) ?? "null");
    if (Array.isArray(raw) && raw.length > 0) {
      const pens = raw.map((p) => cleanPen(p ?? {}, fallback));
      // Ids must be unique: drawings refer to their pen by id.
      const seen = new Set<string>();
      return pens.map((p) => {
        const pen = seen.has(p.id) ? { ...p, id: newId() } : p;
        seen.add(pen.id);
        return pen;
      });
    }
  } catch {
    // Unreadable: start again from the current settings.
  }
  return [fallback];
}

export function savePens(pens: Pen[]): void {
  try {
    window.localStorage.setItem(PENS_KEY, JSON.stringify(pens));
  } catch {
    // Storage full or blocked: the pens still work for this session.
  }
}

export function loadSelectedPenId(pens: Pen[]): string {
  try {
    const id = window.localStorage.getItem(SELECTED_KEY);
    if (id && pens.some((p) => p.id === id)) return id;
  } catch {
    // ignore
  }
  return pens[0].id;
}

export function saveSelectedPenId(id: string): void {
  try {
    window.localStorage.setItem(SELECTED_KEY, id);
  } catch {
    // ignore
  }
}

/** A new pen: a copy of `base`'s settings, with the next unused colour. */
export function newPen(pens: Pen[], base: Pen): Pen {
  const used = new Set(pens.map((p) => p.colour.toLowerCase()));
  const colour = PEN_COLOURS.find((c) => !used.has(c)) ?? PEN_COLOURS[pens.length % PEN_COLOURS.length];
  let n = pens.length + 1;
  while (pens.some((p) => p.name === `Pen ${n}`)) n++;
  return { ...base, id: newId(), name: `Pen ${n}`, colour };
}

/** A pen's name for lists and messages (never blank). */
export const penName = (pen: Pen) => pen.name.trim() || "Unnamed pen";

/** The pen with this id, or the first pen (e.g. for a drawing whose pen was removed). */
export function penById(pens: Pen[], id: string | undefined): Pen {
  return pens.find((p) => p.id === id) ?? pens[0];
}

/** Plan options with this pen's heights and speed. */
export function withPen(options: PlanOptions, pen: Pen): PlanOptions {
  return { ...options, penUpHeight: pen.upHeight, penDownHeight: pen.downHeight, penDownMaxVelocity: pen.speed };
}

// ---- Test square -----------------------------------------------------------------

export const TEST_SQUARE_MM = 10;
const TEST_EDGE_MM = 5; // from the edges of the paper, inside the usual margin
const TEST_STEP_MM = 15; // each new test goes this far along, so they don't overlap

/** How many test squares fit side by side along the paper's home edge. */
export function testSquareSlots(drawableWidthMm: number): number {
  return Math.max(1, Math.floor((drawableWidthMm - TEST_EDGE_MM - TEST_SQUARE_MM) / TEST_STEP_MM) + 1);
}

/**
 * The lines of test square number `slot`, machine mm: a 10 mm square by the
 * pen's home corner, its left half filled with lines one pen-width apart.
 * The filled half shows whether the line width is right: it should look
 * solid, with no gaps and no blotches.
 */
export function testSquareLines(widthMm: number, slot: number): Vec2[][] {
  const s = TEST_SQUARE_MM;
  const x = TEST_EDGE_MM + slot * TEST_STEP_MM;
  const y = TEST_EDGE_MM;
  const square = [
    { x, y },
    { x: x + s, y },
    { x: x + s, y: y + s },
    { x, y: y + s },
    { x, y },
  ];
  const rows = Math.max(1, Math.round(s / Math.max(0.05, widthMm)));
  const zigzag: Vec2[] = [];
  for (let k = 0; k <= rows; k++) {
    const yy = y + (k * s) / rows;
    const [a, b] = k % 2 === 0 ? [x, x + s / 2] : [x + s / 2, x];
    zigzag.push({ x: a, y: yy }, { x: b, y: yy });
  }
  return [square, zigzag];
}

/** A plan that draws test square `slot` with `pen`, from and back to home. */
export function testSquarePlan(pen: Pen, options: PlanOptions, slot: number): Plan {
  const o = withPen(options, pen);
  const device = Device(o.hardware, o.penLiftReversed);
  const spm = device.stepsPerMm;
  const lines = testSquareLines(pen.widthMm, slot).map((l) => l.map((p) => ({ x: p.x * spm, y: p.y * spm })));
  return plan(
    lines,
    {
      penUpPos: device.penPctToPos(o.penUpHeight),
      penDownPos: device.penPctToPos(o.penDownHeight),
      penDownProfile: {
        acceleration: o.penDownAcceleration * spm,
        maximumVelocity: o.penDownMaxVelocity * spm,
        corneringFactor: o.penDownCorneringFactor * spm,
      },
      penUpProfile: {
        acceleration: o.penUpAcceleration * spm,
        maximumVelocity: o.penUpMaxVelocity * spm,
        corneringFactor: 0,
      },
      penDropDuration: o.penDropDuration,
      penLiftDuration: o.penLiftDuration,
    },
    { x: o.penHome.x * spm, y: o.penHome.y * spm },
  );
}
