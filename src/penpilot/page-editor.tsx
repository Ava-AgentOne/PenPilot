/**
 * PenPilot's page editor: the sheet of paper with every drawing on it.
 * Drag a drawing to move it, drag its corner handle to resize it. While
 * plotting, lines already drawn turn teal and the pen's position is marked.
 *
 * Editing changes only the page (fast, no replanning); the plot is
 * recalculated when a drag ends.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { type Plan, XYMotion } from "../planning.js";
import type { Vec2 } from "../vec.js";
import {
  type Bounds,
  centreItem,
  fitItem,
  itemOverflows,
  itemSize,
  itemSvgTransform,
  machineToPage,
  type Page,
  type PageAction,
  type PageItem,
  type Placement,
  rotateItem,
  type Size,
  setPhotoDetail,
} from "./page.js";
import { MAX_DETAIL, MIN_DETAIL, PHOTO_STYLES, type PhotoConfig, TRACE_STYLES } from "./photo.js";

const SNAP_MM = 2;
const MIN_SIZE_MM = 3;

type Drag = { mode: "move" | "resize"; id: string; start: Vec2; item: PageItem; pointerId: number };

/** A plan point (machine steps) on the page (mm). */
function stepsToPage(p: Vec2, stepsPerMm: number, placement: Placement, pageSize: Size): Vec2 {
  return machineToPage({ x: p.x / stepsPerMm, y: p.y / stepsPerMm }, placement, pageSize);
}

function pathData(points: Vec2[]): string {
  let d = "";
  for (let i = 0; i < points.length; i++) d += `${i === 0 ? "M" : "L"}${points[i].x} ${points[i].y}`;
  return d;
}

/** One drawing's lines; memoised so moving another drawing doesn't redraw it. */
const ItemLines = React.memo(function ItemLines({
  item,
  dimmed,
  showPhoto,
}: {
  item: PageItem;
  dimmed: boolean;
  showPhoto: boolean;
}) {
  // One <path> per stroke colour, so each drawing shows in its own pen colours.
  const byColour = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of item.paths) {
      const colour = p.stroke && p.stroke !== "none" ? p.stroke : "#222";
      m.set(colour, (m.get(colour) ?? "") + pathData(p.points));
    }
    return [...m.entries()];
  }, [item.paths]);
  return (
    <g transform={itemSvgTransform(item)}>
      {item.photo && showPhoto && (
        <image
          className="pp-photo"
          href={item.photo.previewUrl}
          x={0}
          y={0}
          width={item.photo.width}
          height={item.photo.height}
          preserveAspectRatio="none"
        />
      )}
      {byColour.map(([colour, d]) => (
        <path
          key={colour}
          className={dimmed ? "pp-item-lines pp-item-lines--dim" : "pp-item-lines"}
          style={dimmed ? undefined : { stroke: colour }}
          d={d}
        />
      ))}
    </g>
  );
});

type CanvasProps = {
  page: Page;
  pageDispatch: (a: PageAction) => void;
  pageSize: Size;
  marginMm: number;
  placement: Placement;
  drawable: Bounds;
  plan: Plan | null;
  stepsPerMm: number;
  progress: number | null;
  /** Editing is locked while the plotter is busy. */
  locked: boolean;
  previewSize: { width: number; height: number };
};

export function PageCanvas({
  page,
  pageDispatch,
  pageSize,
  marginMm,
  placement,
  drawable,
  plan,
  stepsPerMm,
  progress,
  locked,
  previewSize,
}: CanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  // Refs, not just state: pointer events can arrive before React re-renders.
  const dragRef = useRef<Drag | null>(null);
  const draftRef = useRef<PageItem | null>(null);
  const [draft, setDraftState] = useState<PageItem | null>(null);
  const setDraft = (item: PageItem | null) => {
    draftRef.current = item;
    setDraftState(item);
  };

  // Fit the sheet into the preview area.
  const { width, height } =
    (pageSize.x / pageSize.y) * previewSize.height <= previewSize.width
      ? { width: (pageSize.x / pageSize.y) * previewSize.height, height: previewSize.height }
      : { height: (pageSize.y / pageSize.x) * previewSize.width, width: previewSize.width };

  const toMm = (e: React.PointerEvent): Vec2 => {
    const r = (svgRef.current as SVGSVGElement).getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * pageSize.x, y: ((e.clientY - r.top) / r.height) * pageSize.y };
  };

  // The plan, mapped back onto the page: pen-up travel, and each drawing move.
  const planLines = useMemo(() => {
    if (!plan) return null;
    let travel = "";
    const draws: { index: number; d: string }[] = [];
    let isTravel = true; // plans alternate: travel, pen down, draw, pen up, ...
    plan.motions.forEach((m, index) => {
      if (!(m instanceof XYMotion)) return;
      const d = pathData(m.points().map((p) => stepsToPage(p, stepsPerMm, placement, pageSize)));
      if (isTravel) travel += d;
      else draws.push({ index, d });
      isTravel = !isTravel;
    });
    return { travel, draws };
  }, [plan, placement, pageSize, stepsPerMm]);

  const plotting = progress !== null;
  const done = useMemo(() => {
    if (!planLines || progress === null) return "";
    let d = "";
    for (const w of planLines.draws) if (w.index < progress) d += w.d;
    return d;
  }, [planLines, progress]);

  let penAt: Vec2 | null = null;
  if (plan && progress !== null) {
    const m = plan.motions[Math.min(progress, plan.motions.length - 1)];
    if (m instanceof XYMotion) penAt = stepsToPage(m.p1, stepsPerMm, placement, pageSize);
  }

  // Keyboard: Delete removes the selected drawing, arrows nudge it (Shift = 10 mm).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (locked || !page.selectedId) return;
      if (e.target instanceof Element && e.target.closest("input, select, textarea")) return;
      const item = page.items.find((it) => it.id === page.selectedId);
      if (!item) return;
      const step = e.shiftKey ? 10 : 1;
      const nudge: Record<string, Vec2> = {
        ArrowLeft: { x: -step, y: 0 },
        ArrowRight: { x: step, y: 0 },
        ArrowUp: { x: 0, y: -step },
        ArrowDown: { x: 0, y: step },
      };
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        pageDispatch({ type: "remove", id: item.id });
      } else if (nudge[e.key]) {
        e.preventDefault();
        pageDispatch({ type: "nudge", id: item.id, dx: nudge[e.key].x, dy: nudge[e.key].y });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, page, pageDispatch]);

  const startDrag = (e: React.PointerEvent, mode: Drag["mode"], item: PageItem) => {
    if (locked) return;
    e.stopPropagation();
    try {
      (e.target as Element).setPointerCapture(e.pointerId);
    } catch {
      // Not a live pointer (e.g. synthetic events); moves still reach the <svg>.
    }
    pageDispatch({ type: "select", id: item.id });
    dragRef.current = { mode, id: item.id, start: toMm(e), item, pointerId: e.pointerId };
    setDraft(item);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    const p = toMm(e);
    const dx = p.x - drag.start.x;
    const dy = p.y - drag.start.y;
    const it = drag.item;
    const size = itemSize(it);
    if (drag.mode === "move") {
      let x = it.x + dx;
      let y = it.y + dy;
      // Snap the drawing's centre to the middle of the page.
      if (Math.abs(x + size.x / 2 - pageSize.x / 2) < SNAP_MM) x = pageSize.x / 2 - size.x / 2;
      if (Math.abs(y + size.y / 2 - pageSize.y / 2) < SNAP_MM) y = pageSize.y / 2 - size.y / 2;
      setDraft({ ...it, x, y });
    } else {
      // Keep the proportions; follow whichever direction moved more.
      const k = Math.max((size.x + dx) / size.x, (size.y + dy) / size.y);
      const minK = MIN_SIZE_MM / Math.max(1e-9, Math.min(size.x, size.y));
      setDraft({ ...it, scale: it.scale * Math.max(k, minK) });
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (draftRef.current) pageDispatch({ type: "update", item: draftRef.current });
    dragRef.current = null;
    setDraft(null);
  };

  const items = page.items.map((it) => (draft && it.id === draft.id ? draft : it));
  const selected = items.find((it) => it.id === page.selectedId) ?? null;
  const pageRect = `M0 0H${pageSize.x}V${pageSize.y}H0Z`;
  const reachRect = `M${drawable.minX} ${drawable.minY}H${drawable.maxX}V${drawable.maxY}H${drawable.minX}Z`;
  const outOfReach =
    drawable.minX > 0.01 ||
    drawable.minY > 0.01 ||
    drawable.maxX < pageSize.x - 0.01 ||
    drawable.maxY < pageSize.y - 0.01;
  const handleR = Math.max(pageSize.x, pageSize.y) / 120;

  return (
    <div className="preview pp-page" style={{ width, height }}>
      <svg
        ref={svgRef}
        width={width}
        height={height}
        viewBox={`0 0 ${pageSize.x} ${pageSize.y}`}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerDown={() => !locked && pageDispatch({ type: "select", id: null })}
        role="img"
        aria-label="Page"
      >
        <defs>
          <pattern id="pp-unreachable" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="rgba(222, 114, 114, 0.08)" />
            <line x1="0" y1="0" x2="0" y2="4" stroke="rgba(222, 114, 114, 0.45)" strokeWidth="1.2" />
          </pattern>
        </defs>
        {outOfReach && <path className="pp-unreachable" d={`${pageRect}${reachRect}`} />}
        <rect
          className="pp-margin"
          x={marginMm}
          y={marginMm}
          width={Math.max(0, pageSize.x - 2 * marginMm)}
          height={Math.max(0, pageSize.y - 2 * marginMm)}
        />
        {items.map((it) => (
          <ItemLines
            key={it.id}
            item={it}
            dimmed={plotting}
            showPhoto={!plotting && (it.id === page.selectedId || it.paths.length === 0)}
          />
        ))}
        {planLines && !draft && <path className="pp-travel" d={planLines.travel} />}
        {plotting && <path className="pp-done" d={done} />}
        {penAt && (
          <g className="pp-pen" transform={`translate(${penAt.x} ${penAt.y})`}>
            <circle r={handleR * 1.6} />
            <path d={`M${-handleR * 3} 0H${handleR * 3}M0 ${-handleR * 3}V${handleR * 3}`} />
          </g>
        )}
        {!plotting &&
          items.map((it) => {
            const s = itemSize(it);
            const isSel = it.id === selected?.id;
            const overflow = itemOverflows(it, drawable);
            return (
              <g key={`box-${it.id}`}>
                <rect
                  className={`pp-hit${isSel ? " pp-hit--selected" : ""}${overflow ? " pp-hit--overflow" : ""}`}
                  x={it.x}
                  y={it.y}
                  width={s.x}
                  height={s.y}
                  onPointerDown={(e) => startDrag(e, "move", it)}
                >
                  <title>{it.name}</title>
                </rect>
                {isSel && (
                  <circle
                    className="pp-handle"
                    cx={it.x + s.x}
                    cy={it.y + s.y}
                    r={handleR}
                    onPointerDown={(e) => startDrag(e, "resize", it)}
                  >
                    <title>Drag to resize</title>
                  </circle>
                )}
              </g>
            );
          })}
      </svg>
    </div>
  );
}

// ---- Side panel -------------------------------------------------------------------

type PanelProps = {
  /** Replace an SVG made of filled shapes by its centre-line trace. */
  onTraceSvg: (item: PageItem) => void;
  page: Page;
  pageDispatch: (a: PageAction) => void;
  pageSize: Size;
  marginMm: number;
  drawable: Bounds;
  locked: boolean;
  onAddFiles: (files: File[]) => void;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

function NumberField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}) {
  // Local text so typing "1" on the way to "120" doesn't fight the value.
  const [text, setText] = useState(String(round1(value)));
  useEffect(() => setText(String(round1(value))), [value]);
  const commit = () => {
    const v = Number(text);
    if (Number.isFinite(v)) onChange(v);
    else setText(String(round1(value)));
  };
  return (
    <label className="pp-field">
      {label}
      <input
        type="number"
        step="0.5"
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
    </label>
  );
}

export function DrawingsPanel({
  page,
  pageDispatch,
  pageSize,
  marginMm,
  drawable,
  locked,
  onAddFiles,
  onTraceSvg,
}: PanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const selected = page.items.find((it) => it.id === page.selectedId) ?? null;
  const update = (item: PageItem) => pageDispatch({ type: "update", item });
  const overflowing = page.items.filter((it) => itemOverflows(it, drawable));
  const size = selected ? itemSize(selected) : null;

  const resizeTo = (axis: "x" | "y", mm: number) => {
    if (!selected || !size || mm < MIN_SIZE_MM) return;
    update({ ...selected, scale: selected.scale * (mm / size[axis]) });
  };

  return (
    <div className="pp-drawings">
      <input
        ref={fileInput}
        type="file"
        accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp,image/gif,image/bmp"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          onAddFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <button type="button" disabled={locked} onClick={() => fileInput.current?.click()}>
        Add drawing or photo…
      </button>
      {page.items.length > 0 && (
        <ul className="pp-item-list">
          {page.items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                className={`button-link pp-item-name${it.id === page.selectedId ? " pp-item-name--selected" : ""}`}
                onClick={() => pageDispatch({ type: "select", id: it.id })}
                title={it.name}
              >
                {itemOverflows(it, drawable) ? "⚠ " : ""}
                {it.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected?.fillOnly && (
        <div className="pp-note pp-fill-only">
          This drawing is made of <strong>filled shapes</strong>. A pen can only go round their edges, so every line
          would be drawn twice (along both sides).
          <button type="button" className="pp-fill-only-button" disabled={locked} onClick={() => onTraceSvg(selected)}>
            Trace centre lines instead
          </button>
        </div>
      )}
      {selected?.photo && <PhotoPanel item={selected} pageDispatch={pageDispatch} locked={locked} />}
      {selected && size && (
        <div className="pp-selected">
          <div className="pp-fields">
            <NumberField
              label="x (mm)"
              value={selected.x}
              disabled={locked}
              onChange={(x) => update({ ...selected, x })}
            />
            <NumberField
              label="y (mm)"
              value={selected.y}
              disabled={locked}
              onChange={(y) => update({ ...selected, y })}
            />
            <NumberField label="width (mm)" value={size.x} disabled={locked} onChange={(v) => resizeTo("x", v)} />
            <NumberField label="height (mm)" value={size.y} disabled={locked} onChange={(v) => resizeTo("y", v)} />
          </div>
          <div className="pp-buttons">
            <button type="button" disabled={locked} onClick={() => update(rotateItem(selected))}>
              Turn 90°
            </button>
            <button type="button" disabled={locked} onClick={() => update(centreItem(selected, pageSize))}>
              Centre
            </button>
            <button type="button" disabled={locked} onClick={() => update(fitItem(selected, pageSize, marginMm))}>
              Fit page
            </button>
            <button type="button" disabled={locked} onClick={() => pageDispatch({ type: "remove", id: selected.id })}>
              Remove
            </button>
          </div>
        </div>
      )}
      {overflowing.length > 0 && (
        <div className="pp-warning">
          Part of {overflowing.map((it) => `“${it.name}”`).join(", ")} is outside the area the plotter can draw, so
          those lines will be cut off.
        </div>
      )}
      {page.items.length > 0 && (
        <div className="pp-hint">Drag to move, drag the corner dot to resize. Arrow keys nudge, Delete removes.</div>
      )}
    </div>
  );
}

// ---- Paper orientation ---------------------------------------------------------------

export function OrientationNotes({
  isLandscape,
  onOrientation,
  placement,
  pageSize,
  reach,
  locked,
}: {
  isLandscape: boolean;
  onOrientation: (landscape: boolean) => void;
  placement: Placement;
  pageSize: Size;
  reach: Size | null;
  locked: boolean;
}) {
  const tooBig = reach !== null && Math.min(pageSize.x, pageSize.y) > reach.y + 0.01;
  const tooLong = reach !== null && Math.max(pageSize.x, pageSize.y) > reach.x + 0.01;
  return (
    <div className="pp-orientation">
      <fieldset className="pp-segmented">
        <legend className="pp-sr-only">Paper orientation</legend>
        <button
          type="button"
          aria-pressed={!isLandscape}
          className={!isLandscape ? "pp-on" : ""}
          disabled={locked}
          onClick={() => onOrientation(false)}
        >
          Portrait
        </button>
        <button
          type="button"
          aria-pressed={isLandscape}
          className={isLandscape ? "pp-on" : ""}
          disabled={locked}
          onClick={() => onOrientation(true)}
        >
          Landscape
        </button>
      </fieldset>
      {placement === "sideways" && (
        <div className="pp-note">
          Put the sheet in the plotter <strong>sideways</strong>, with the <strong>top of the page on the left</strong>.
          PenPilot turns the drawing to match.
        </div>
      )}
      {(tooBig || tooLong) && reach && (
        <div className="pp-warning">
          This paper is bigger than the plotter can reach ({reach.x} × {reach.y} mm). The striped part of the page won't
          be drawn.
        </div>
      )}
    </div>
  );
}

// ---- Photo styles --------------------------------------------------------------------

function PhotoPanel({
  item,
  pageDispatch,
  locked,
}: {
  item: PageItem;
  pageDispatch: (a: PageAction) => void;
  locked: boolean;
}) {
  const photo = item.photo as NonNullable<PageItem["photo"]>;
  const set = (config: PhotoConfig) => pageDispatch({ type: "photoSettings", id: item.id, config });
  return (
    <div className="pp-photo-panel">
      <label className="pp-field">
        style
        <select
          value={photo.style}
          disabled={locked}
          onChange={(e) => pageDispatch({ type: "photoSettings", id: item.id, style: e.target.value })}
        >
          <optgroup label="Trace (vector lines)">
            {TRACE_STYLES.map((st) => (
              <option key={st.file} value={st.file}>
                {st.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Art styles (Plotterfun)">
            {PHOTO_STYLES.map((st) => (
              <option key={st.file} value={st.file}>
                {st.name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <SliderField
        label="Detail (px)"
        value={photo.detail}
        min={MIN_DETAIL}
        max={MAX_DETAIL}
        step={50}
        disabled={locked}
        onChange={(detail) => pageDispatch({ type: "update", item: setPhotoDetail(item, detail) })}
      />
      {photo.controls.map((c) =>
        c.type === "checkbox" ? (
          <label key={c.label} className="pp-checkbox">
            <input
              type="checkbox"
              disabled={locked}
              checked={!!photo.config[c.label]}
              onChange={(e) => set({ [c.label]: e.target.checked })}
            />
            {c.label}
          </label>
        ) : c.type === "select" ? (
          <label key={c.label} className="pp-field">
            {c.label}
            <select
              value={String(photo.config[c.label] ?? "")}
              disabled={locked}
              onChange={(e) => set({ [c.label]: e.target.value })}
            >
              {(c.options ?? []).map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
        ) : (
          <SliderField
            key={c.label}
            label={c.label}
            value={Number(photo.config[c.label] ?? c.value ?? 0)}
            min={c.min ?? 0}
            max={c.max ?? 100}
            step={c.step ?? 1}
            disabled={locked}
            onChange={(v) => set({ [c.label]: v })}
          />
        ),
      )}
      <div className={`pp-photo-status pp-photo-status--${photo.status}`}>
        {photo.status === "error"
          ? `Couldn't draw this: ${photo.message}`
          : photo.status === "working"
            ? photo.message || "Drawing…"
            : `${item.paths.length.toLocaleString()} pen ${item.paths.length === 1 ? "stroke" : "strokes"}`}
      </div>
    </div>
  );
}

/** A slider with its value shown; reports changes as you drag. */
function SliderField({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <label className="pp-slider">
      <span className="pp-slider-label">
        {label}
        <span className="pp-slider-value">{Number.isInteger(step) ? value : value.toFixed(2)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
