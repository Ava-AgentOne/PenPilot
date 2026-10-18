/**
 * Worker for serializing a plan.
 * Meant to be invoked through the Worker interface.
 *
 * PenPilot: the page arrives as one job per pen (in plotting order), each with
 * that pen's settings, and becomes one plot that stops before each new pen.
 */
import type { Path } from "flatten-svg";
import { replan } from "./massager.js";
import { joinPenPlans } from "./penpilot/plot-job.js";
import { Device, type PlanOptions, XYMotion } from "./planning.js";

export interface PlanJob {
  penId: string;
  paths: Path[];
  planOptions: PlanOptions;
}

self.addEventListener("message", (m) => {
  const { jobs } = m.data as { jobs: PlanJob[] };
  const plan = joinPenPlans(
    jobs.map((job) => ({
      penId: job.penId,
      penUpPos: Device(job.planOptions.hardware, job.planOptions.penLiftReversed).penPctToPos(
        job.planOptions.penUpHeight,
      ),
      plan: replan(job.paths, job.planOptions),
    })),
  );
  console.time("serializing");
  const motions = plan.toTransferable();
  const buffers = plan.motions
    .filter((x): x is XYMotion => x instanceof XYMotion)
    .flatMap((x) => [x.cols.buffer, x.ts.buffer, x.ss.buffer]);
  console.timeEnd("serializing");
  self.postMessage(motions, { transfer: buffers });
});
