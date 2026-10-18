/** Paper sizes the user has named and saved (e.g. "Card 10x15"), kept on this computer. */

const KEY = "penpilot.paperSizes";

export interface SavedPaperSize {
  name: string;
  /** mm; stored as entered, orientation is applied when chosen. */
  x: number;
  y: number;
}

export function loadPaperSizes(): SavedPaperSize[] {
  try {
    const list = JSON.parse(window.localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list)
      ? list.filter((s) => typeof s?.name === "string" && Number.isFinite(s?.x) && Number.isFinite(s?.y))
      : [];
  } catch {
    return [];
  }
}

export function savePaperSizes(list: SavedPaperSize[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable: the size just won't be remembered.
  }
}

/** Same size, either way round. */
export const sameSize = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  (Math.abs(a.x - b.x) < 0.05 && Math.abs(a.y - b.y) < 0.05) ||
  (Math.abs(a.x - b.y) < 0.05 && Math.abs(a.y - b.x) < 0.05);
