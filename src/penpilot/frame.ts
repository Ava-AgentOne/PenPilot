/**
 * PenPilot's "Frame": with the pen held up, trace the rectangle the drawing will
 * cover, so the paper can be lined up before any ink goes down.
 */

import { Device, type Plan, type PlanOptions, plan } from "../planning.js";
import type { Bounds } from "./page.js";

/** Framing speed, mm/s: slow enough to follow by eye. */
const FRAME_SPEED_MM_S = 60;

/**
 * A plan that goes round `box` (machine mm) `laps` times and returns home,
 * with the pen up the whole time. Corners are taken at a full stop
 * (cornering factor 0), so they're easy to see.
 */
export function framePlan(box: Bounds, options: PlanOptions, laps = 1): Plan {
  const device = Device(options.hardware, options.penLiftReversed);
  const spm = device.stepsPerMm;
  const up = device.penPctToPos(options.penUpHeight);
  const corner = (x: number, y: number) => ({ x: x * spm, y: y * spm });
  const lap = [
    corner(box.minX, box.minY),
    corner(box.maxX, box.minY),
    corner(box.maxX, box.maxY),
    corner(box.minX, box.maxY),
  ];
  const route = [];
  for (let i = 0; i < Math.max(1, laps); i++) route.push(...lap);
  route.push(lap[0]);

  const profile = {
    acceleration: options.penDownAcceleration * spm,
    maximumVelocity: Math.min(FRAME_SPEED_MM_S, options.penUpMaxVelocity) * spm,
    corneringFactor: 0,
  };
  return plan(
    [route],
    {
      penUpPos: up,
      // "Down" is the up position too: the pen never touches the paper.
      penDownPos: up,
      penDownProfile: profile,
      penUpProfile: profile,
      // Non-zero, so the "pen moves" become a harmless 10 ms wait.
      penLiftDuration: 0.01,
      penDropDuration: 0.01,
    },
    { x: options.penHome.x * spm, y: options.penHome.y * spm },
  );
}
