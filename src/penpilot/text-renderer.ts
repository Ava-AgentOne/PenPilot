/** Keeps every text item's pen strokes in step with its text and settings. */

import { useEffect, useRef } from "react";
import type { PageAction, PageItem } from "./page.js";
import { layoutText, loadSingleLineFont, missingCharacters, textJobKey } from "./text.js";

export function usePenText(items: PageItem[], dispatch: (a: PageAction) => void): void {
  const done = useRef(new Map<string, string>());
  useEffect(() => {
    for (const item of items) {
      const t = item.text;
      if (!t) continue;
      const key = textJobKey(t);
      if (done.current.get(item.id) === key) continue;
      done.current.set(item.id, key);
      const id = item.id;
      loadSingleLineFont(t.font)
        .then((font) => {
          if (done.current.get(id) !== key) return; // settings changed meanwhile
          const { paths, width, height } = layoutText(font, t);
          const missing = missingCharacters(font, t.text);
          dispatch({
            type: "textResult",
            id,
            paths,
            width,
            height,
            error: missing.length ? `This font can't write: ${missing.join(" ")}` : undefined,
          });
        })
        .catch((e: Error) => dispatch({ type: "textResult", id, paths: [], width: 1, height: 1, error: e.message }));
    }
    const live = new Set(items.map((it) => it.id));
    for (const id of done.current.keys()) if (!live.has(id)) done.current.delete(id);
  }, [items, dispatch]);
}
