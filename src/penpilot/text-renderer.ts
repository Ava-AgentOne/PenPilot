/** Keeps every text item's pen strokes in step with its text and settings. */

import type { Path } from "flatten-svg";
import { useEffect, useRef } from "react";
import type { PageAction, PageItem } from "./page.js";
import { type PhotoJob, runPhotoStyle } from "./photo.js";
import { layoutText, loadSingleLineFont, missingCharacters, type TextInfo, textJobKey } from "./text.js";
import { isTracedFont, renderTracedText, tracedFont } from "./traced-text.js";

type Result = { paths: Path[]; width: number; height: number; error?: string };

/** Single-stroke fonts: lay the letters out directly. */
async function singleStroke(t: TextInfo): Promise<Result> {
  const font = await loadSingleLineFont(t.font);
  const { paths, width, height } = layoutText(font, t);
  const missing = missingCharacters(font, t.text);
  return { paths, width, height, error: missing.length ? `This font can't write: ${missing.join(" ")}` : undefined };
}

/** Ordinary fonts (Arabic, extra handwriting): draw the text, then trace its centre lines. */
function traced(t: TextInfo, onJob: (job: PhotoJob) => void): Promise<Result> {
  const f = tracedFont(t.font);
  if (!f) return Promise.reject(new Error("Unknown font"));
  return renderTracedText(f.family, t.text, t.sizeMm, t.letterSpacing, t.lineSpacing, t.align).then(
    ({ image, mmPerPx, traceConfig }) =>
      new Promise<Result>((resolve, reject) => {
        onJob(
          runPhotoStyle("trace-centre", traceConfig, image, {
            onControls() {},
            onMessage() {},
            onError: (text) => reject(new Error(text)),
            onLines(lines) {
              // To mm, and trim the box to the ink (plus a hair of margin).
              let minX = Number.POSITIVE_INFINITY;
              let minY = Number.POSITIVE_INFINITY;
              let maxX = Number.NEGATIVE_INFINITY;
              let maxY = Number.NEGATIVE_INFINITY;
              for (const l of lines) {
                for (const p of l.points) {
                  minX = Math.min(minX, p.x);
                  minY = Math.min(minY, p.y);
                  maxX = Math.max(maxX, p.x);
                  maxY = Math.max(maxY, p.y);
                }
              }
              if (!Number.isFinite(minX)) {
                resolve({ paths: [], width: t.sizeMm, height: t.sizeMm });
                return;
              }
              const m = 1 / mmPerPx; // 1 mm margin, in px
              const paths = lines.map((l) => ({
                ...l,
                points: l.points.map((p) => ({ x: (p.x - minX + m) * mmPerPx, y: (p.y - minY + m) * mmPerPx })),
              }));
              resolve({ paths, width: (maxX - minX + 2 * m) * mmPerPx, height: (maxY - minY + 2 * m) * mmPerPx });
            },
          }),
        );
      }),
  );
}

export function usePenText(items: PageItem[], dispatch: (a: PageAction) => void): void {
  const done = useRef(new Map<string, string>());
  const jobs = useRef(new Map<string, PhotoJob>());
  useEffect(() => {
    for (const item of items) {
      const t = item.text;
      if (!t) continue;
      const key = textJobKey(t);
      if (done.current.get(item.id) === key) continue;
      done.current.set(item.id, key);
      const id = item.id;
      jobs.current.get(id)?.cancel();
      const work = isTracedFont(t.font) ? traced(t, (job) => jobs.current.set(id, job)) : singleStroke(t);
      work
        .then((r) => {
          if (done.current.get(id) !== key) return; // settings changed meanwhile
          dispatch({ type: "textResult", id, ...r });
        })
        .catch((e: Error) => {
          if (done.current.get(id) !== key) return;
          dispatch({ type: "textResult", id, paths: [], width: 1, height: 1, error: e.message });
        });
    }
    const live = new Set(items.map((it) => it.id));
    for (const id of done.current.keys()) {
      if (live.has(id)) continue;
      done.current.delete(id);
      jobs.current.get(id)?.cancel();
      jobs.current.delete(id);
    }
  }, [items, dispatch]);
}
