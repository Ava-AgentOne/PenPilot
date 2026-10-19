/**
 * The small toolbar at the top of the workspace (undo, redo, save, duplicate,
 * delete, zoom, pen-up moves), and the workspace zoom: pinch or Cmd/Ctrl +
 * scroll zooms towards the pointer, and the page scrolls when zoomed in.
 */

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// Icon outlines (24 x 24, drawn with the current text colour).
const ICONS: Record<string, string[]> = {
  undo: ["M9 14 4 9l5-5", "M4 9h10.5a5.5 5.5 0 0 1 0 11H11"],
  redo: ["m15 14 5-5-5-5", "M20 9H9.5a5.5 5.5 0 0 0 0 11H13"],
  save: ["M5 3h11l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 1-2z", "M8 3v5h7V3", "M8 21v-6h8v6"],
  duplicate: [
    "M10 8h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z",
    "M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2",
  ],
  delete: ["M4 7h16", "M10 11v6", "M14 11v6", "m5 7 1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12", "M9 7V4h6v3"],
  zoomOut: ["M4 11a7 7 0 1 0 14 0a7 7 0 1 0-14 0", "M8 11h6", "m20 20-4-4"],
  zoomIn: ["M4 11a7 7 0 1 0 14 0a7 7 0 1 0-14 0", "M8 11h6", "M11 8v6", "m20 20-4-4"],
  fit: ["M4 9V4h5", "M20 9V4h-5", "M4 15v5h5", "M20 15v5h-5"],
  travel: ["M4 18c4-12 12 0 16-12"],
};

const Icon = React.memo(function Icon({ name, dashed }: { name: string; dashed?: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[name].map((d) => (
        <path
          key={d}
          d={d}
          // Inline: saxi's style.css paints every <path> black.
          style={{
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 2,
            strokeLinecap: "round",
            strokeLinejoin: "round",
            strokeDasharray: dashed ? "2 3.5" : undefined,
          }}
        />
      ))}
    </svg>
  );
});

function Tool({
  icon,
  label,
  onClick,
  disabled,
  pressed,
  dashed,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  dashed?: boolean;
}) {
  return (
    <button
      type="button"
      className={`pp-tool${pressed ? " pp-tool--on" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} dashed={dashed} />
    </button>
  );
}

const mac = typeof navigator !== "undefined" && navigator.platform.startsWith("Mac");
const key = (k: string) => (mac ? `⌘${k}` : `Ctrl+${k}`);

export function WorkspaceToolbar({
  canUndo,
  canRedo,
  canSave,
  hasSelection,
  locked,
  zoom,
  showTravel,
  onUndo,
  onRedo,
  onSave,
  onDuplicate,
  onDelete,
  onZoomIn,
  onZoomOut,
  onFit,
  onToggleTravel,
}: {
  canUndo: boolean;
  canRedo: boolean;
  canSave: boolean;
  hasSelection: boolean;
  locked: boolean;
  zoom: number;
  showTravel: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onToggleTravel: () => void;
}) {
  return (
    <div className="pp-toolbar" role="toolbar" aria-label="Page tools">
      <Tool icon="undo" label={`Undo (${key("Z")})`} onClick={onUndo} disabled={!canUndo || locked} />
      <Tool icon="redo" label={`Redo (${mac ? "⇧⌘Z" : "Ctrl+Y"})`} onClick={onRedo} disabled={!canRedo || locked} />
      <span className="pp-tool-gap" />
      <Tool icon="save" label={`Save (${key("S")})`} onClick={onSave} disabled={!canSave} />
      <span className="pp-tool-gap" />
      <Tool
        icon="duplicate"
        label={`Duplicate the selected drawing (${key("D")})`}
        onClick={onDuplicate}
        disabled={!hasSelection || locked}
      />
      <Tool
        icon="delete"
        label="Remove the selected drawing (Delete)"
        onClick={onDelete}
        disabled={!hasSelection || locked}
      />
      <span className="pp-tool-gap" />
      <Tool icon="zoomOut" label={`Zoom out (${key("−")})`} onClick={onZoomOut} disabled={zoom <= MIN_ZOOM + 1e-6} />
      <button type="button" className="pp-tool pp-tool-zoom" title={`Fit the page (${key("0")})`} onClick={onFit}>
        {Math.round(zoom * 100)}%
      </button>
      <Tool icon="zoomIn" label={`Zoom in (${key("+")})`} onClick={onZoomIn} disabled={zoom >= MAX_ZOOM - 1e-6} />
      <Tool icon="fit" label={`Fit the page (${key("0")})`} onClick={onFit} disabled={zoom === 1} />
      <span className="pp-tool-gap" />
      <Tool
        icon="travel"
        dashed
        label={showTravel ? "Hide the pen-up moves (grey lines)" : "Show the pen-up moves (grey lines)"}
        onClick={onToggleTravel}
        pressed={showTravel}
      />
    </div>
  );
}

// ---- Zoom ------------------------------------------------------------------------------

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 8;
const STEP = 1.25;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * Zoom for the scrolling area `scroller` (1 = the page fits). Zooming keeps
 * the point under the pointer (or the middle of the view) where it was.
 */
export function useZoom() {
  const scroller = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(1);
  zoomRef.current = zoom;
  // Where to keep still: a fraction of the content, and its place in the view.
  const anchor = useRef<{ fx: number; fy: number; cx: number; cy: number } | null>(null);

  const zoomTo = useCallback((z: number, at?: { x: number; y: number }) => {
    const el = scroller.current;
    const next = clampZoom(z);
    if (el && next !== zoomRef.current) {
      const cx = at ? at.x : el.clientWidth / 2;
      const cy = at ? at.y : el.clientHeight / 2;
      anchor.current = {
        fx: (el.scrollLeft + cx) / Math.max(1, el.scrollWidth),
        fy: (el.scrollTop + cy) / Math.max(1, el.scrollHeight),
        cx,
        cy,
      };
    }
    setZoom(next);
  }, []);

  // After each zoom change has re-rendered the page at its new size, scroll so the anchor stays put.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once per zoom change on purpose
  useLayoutEffect(() => {
    const el = scroller.current;
    const a = anchor.current;
    anchor.current = null;
    if (!el || !a) return;
    el.scrollLeft = a.fx * el.scrollWidth - a.cx;
    el.scrollTop = a.fy * el.scrollHeight - a.cy;
  }, [zoom]);

  // Pinch on a trackpad (the browser sends it as Ctrl + wheel) or Cmd/Ctrl + scroll wheel.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomTo(zoomRef.current * Math.exp(-e.deltaY * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  return {
    scroller,
    zoom,
    zoomIn: () => zoomTo(zoomRef.current * STEP),
    zoomOut: () => zoomTo(zoomRef.current / STEP),
    fit: () => zoomTo(1),
  };
}

/** Typing in a text box: Undo / Redo belong to the text, not the page. */
export function editingText(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  return el instanceof HTMLInputElement && ["text", "number", "search", ""].includes(el.type);
}
