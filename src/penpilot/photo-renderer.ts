/**
 * Keeps every photo's lines up to date: when a photo's style, detail or
 * settings change, (re)run its Plotterfun style in a worker, a moment after
 * the last change so dragging a slider doesn't start dozens of runs.
 */

import { useEffect, useRef } from "react";
import type { PageAction, PageItem } from "./page.js";
import { type PhotoJob, photoJobKey, rasterise, runPhotoStyle } from "./photo.js";

const SETTLE_MS = 250;

interface Entry {
  key: string;
  job?: PhotoJob;
  timer?: ReturnType<typeof setTimeout>;
}

export function usePhotoRenderer(items: PageItem[], dispatch: (a: PageAction) => void): void {
  const entries = useRef(new Map<string, Entry>());

  useEffect(() => {
    const live = new Set<string>();
    for (const item of items) {
      const photo = item.photo;
      if (!photo) continue;
      live.add(item.id);
      const key = photoJobKey(photo);
      const old = entries.current.get(item.id);
      if (old?.key === key) continue;
      old?.job?.cancel();
      clearTimeout(old?.timer);

      const entry: Entry = { key };
      entries.current.set(item.id, entry);
      const id = item.id;
      entry.timer = setTimeout(() => {
        const image = rasterise(photo.bitmap, photo.width, photo.height);
        entry.job = runPhotoStyle(photo.style, photo.config, image, {
          onControls(controls, config) {
            // The style filled in its defaults: that's what is being drawn now.
            entry.key = photoJobKey({ ...photo, config });
            dispatch({ type: "photoMeta", id, controls, config });
          },
          onLines: (paths) => dispatch({ type: "photoResult", id, paths }),
          onMessage: (text) =>
            dispatch({
              type: "photoStatus",
              id,
              status: text === "Done" || text === "" ? "done" : "working",
              message: text,
            }),
          onError: (text) => dispatch({ type: "photoStatus", id, status: "error", message: text }),
        });
      }, SETTLE_MS);
    }
    for (const [id, entry] of entries.current) {
      if (live.has(id)) continue;
      entry.job?.cancel();
      clearTimeout(entry.timer);
      entries.current.delete(id);
    }
  }, [items, dispatch]);

  // Stop everything when the editor goes away.
  useEffect(() => {
    const all = entries.current;
    return () => {
      for (const entry of all.values()) {
        entry.job?.cancel();
        clearTimeout(entry.timer);
      }
      all.clear();
    };
  }, []);
}
