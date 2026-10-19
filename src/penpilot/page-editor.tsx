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
  itemDrawnPaths,
  itemOverflows,
  itemSize,
  itemSvgTransform,
  machineToPage,
  type Page,
  type PageAction,
  type PageItem,
  type Placement,
  resizeShape,
  rotateItem,
  type Size,
  setPhotoDetail,
  splitByColour,
  strokeColours,
} from "./page.js";
import { type Pen, penName } from "./pens.js";
import { PenSwatch } from "./pens-panel.js";
import { drawnLines } from "./plot-job.js";
import { Fold, MenuButton } from "./panel-ui.js";
import { MAX_SHAPE_LINES } from "./shapes.js";
import type { FillInfo, FillKind } from "./hatch.js";
import { MAX_DETAIL, MIN_DETAIL, PHOTO_STYLES, type PhotoConfig, TRACE_STYLES } from "./photo.js";
import { type Align, SINGLE_LINE_FONTS, type TextInfo } from "./text.js";
import { isTracedFont, TRACED_FONTS } from "./traced-text.js";

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

/**
 * One drawing's lines, in its pen's colour -- at the pen's real line width
 * (`widthMm`), or as hairlines. Memoised so moving another drawing doesn't
 * redraw it.
 */
const ItemLines = React.memo(function ItemLines({
  item,
  dimmed,
  off,
  showPhoto,
  colour,
  widthMm,
}: {
  item: PageItem;
  dimmed: boolean;
  /** Not ticked for plotting: shown faint. */
  off: boolean;
  showPhoto: boolean;
  colour: string;
  widthMm: number | null;
}) {
  const drawn = itemDrawnPaths(item).paths; // the item's lines plus any hatch fill
  const d = useMemo(() => drawn.map((p) => pathData(p.points)).join(""), [drawn]);
  const lineClass = `pp-item-lines${widthMm !== null ? " pp-item-lines--true" : ""}${dimmed ? " pp-item-lines--dim" : ""}${off ? " pp-item-lines--off" : ""}`;
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
      <path
        className={lineClass}
        style={{
          stroke: dimmed ? undefined : colour,
          // In the item's own units: it's drawn inside the item's scale().
          strokeWidth: widthMm !== null ? widthMm / item.scale : undefined,
        }}
        d={d}
      />
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
  /** The pen that draws each drawing (its colour and line width). */
  penOf: (item: PageItem) => Pen;
  /** Draw lines at the pen's real width instead of as hairlines. */
  trueWidth: boolean;
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
  penOf,
  trueWidth,
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
    const drawing = new Set(drawnLines(plan)); // the pen-down moves; the rest is travel
    plan.motions.forEach((m, index) => {
      if (!(m instanceof XYMotion)) return;
      const d = pathData(m.points().map((p) => stepsToPage(p, stepsPerMm, placement, pageSize)));
      if (drawing.has(index)) draws.push({ index, d });
      else travel += d;
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
    } else if (it.shape) {
      // Shapes stretch freely: width and height change separately.
      setDraft(resizeShape(it, Math.max(MIN_SIZE_MM, size.x + dx), Math.max(MIN_SIZE_MM, size.y + dy)));
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
        {items.map((it) => {
          const pen = penOf(it);
          return (
            <ItemLines
              key={it.id}
              item={it}
              dimmed={plotting}
              off={!!it.skip}
              showPhoto={!plotting && (it.id === page.selectedId || it.paths.length === 0)}
              colour={pen.colour}
              widthMm={trueWidth ? pen.widthMm : null}
            />
          );
        })}
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
  pens: Pen[];
  penOf: (item: PageItem) => Pen;
  onAddText: () => void;
  onAddShape: (kind: "rect" | "ellipse" | "border") => void;
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

/** Whether two CSS colours ("red", "#f00", "#ff0000") are the same. */
function sameColour(a: string, b: string): boolean {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx || !a || !b) return false;
  // An invalid colour (e.g. "none") leaves fillStyle unchanged.
  const norm = (c: string) => {
    ctx.fillStyle = "#010203";
    ctx.fillStyle = c;
    return ctx.fillStyle === "#010203" ? null : ctx.fillStyle;
  };
  const na = norm(a);
  return na !== null && na === norm(b);
}

const FILL_NAMES: Record<FillKind, string> = {
  none: "none",
  lines: "lines",
  cross: "cross-hatch",
  concentric: "concentric",
};

export function DrawingsPanel({
  page,
  pageDispatch,
  pageSize,
  marginMm,
  drawable,
  locked,
  onAddFiles,
  onTraceSvg,
  onAddText,
  onAddShape,
  pens,
  penOf,
}: PanelProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const selected = page.items.find((it) => it.id === page.selectedId) ?? null;
  const update = (item: PageItem) => pageDispatch({ type: "update", item });
  const overflowing = page.items.filter((it) => itemOverflows(it, drawable));
  const size = selected ? itemSize(selected) : null;
  const fillable = selected ? itemDrawnPaths(selected).shapes > 0 || !!selected.fill : false;

  const resizeTo = (axis: "x" | "y", mm: number) => {
    if (!selected || !size || mm < MIN_SIZE_MM) return;
    // Shapes change width and height separately; drawings keep their proportions.
    if (selected.shape) update(resizeShape(selected, axis === "x" ? mm : size.x, axis === "y" ? mm : size.y));
    else update({ ...selected, scale: selected.scale * (mm / size[axis]) });
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
      <MenuButton
        className="pp-add"
        label="+ Add"
        disabled={locked}
        items={[
          { label: "Drawing or photo…", onSelect: () => fileInput.current?.click() },
          { label: "Text", onSelect: onAddText },
          { label: "Rectangle", onSelect: () => onAddShape("rect"), separator: true },
          { label: "Circle", onSelect: () => onAddShape("ellipse") },
          { label: "Border round the page", onSelect: () => onAddShape("border") },
        ]}
      />
      {page.items.length > 0 && (
        <ul
          className="pp-item-list"
          title="Drag a drawing to move it, drag its corner dot to resize. Arrow keys nudge, Delete removes."
        >
          {page.items.map((it) => (
            <li key={it.id}>
              <input
                type="checkbox"
                className="pp-item-plot"
                checked={!it.skip}
                disabled={locked}
                title={it.skip ? "Not plotted. Tick to plot it." : "Plotted. Untick to leave it out of Plot and Frame."}
                aria-label={`Plot ${it.name}`}
                onChange={(e) => pageDispatch({ type: "plot", id: it.id, on: e.target.checked })}
              />
              <MenuButton
                className="pp-item-pen-menu"
                caret={false}
                disabled={locked}
                title={`Drawn with ${penName(penOf(it))}. Click to choose another pen.`}
                ariaLabel={`Pen for ${it.name}: ${penName(penOf(it))}`}
                label={<PenSwatch pen={penOf(it)} />}
                items={pens.map((p) => ({
                  label: (
                    <>
                      <PenSwatch pen={p} />
                      {penName(p)}
                      {p.id === penOf(it).id ? " ✓" : ""}
                    </>
                  ),
                  onSelect: () => pageDispatch({ type: "pen", id: it.id, penId: p.id }),
                }))}
              />
              <button
                type="button"
                className={`button-link pp-item-name${it.id === page.selectedId ? " pp-item-name--selected" : ""}${it.skip ? " pp-item-name--off" : ""}`}
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
      {page.items.length > 0 && page.items.every((it) => it.skip) && (
        <div className="pp-note">Nothing is ticked, so there's nothing to plot. Tick the drawings to plot.</div>
      )}
      {overflowing.length > 0 && (
        <div className="pp-warning">
          Part of {overflowing.map((it) => `“${it.name}”`).join(", ")} is outside the area the plotter can draw, so
          those lines will be cut off.
        </div>
      )}
      {selected?.fillOnly && (
        <div className="pp-note pp-fill-only">
          This drawing is made of <strong>filled shapes</strong>. A pen can only go round their edges, so every line
          would be drawn twice (along both sides).
          <button type="button" className="pp-fill-only-button" disabled={locked} onClick={() => onTraceSvg(selected)}>
            Trace centre lines instead
          </button>
          {!selected.fill && (
            <button
              type="button"
              className="pp-fill-only-button"
              disabled={locked}
              onClick={() => pageDispatch({ type: "fill", id: selected.id, fill: {} })}
            >
              Fill them with hatching
            </button>
          )}
        </div>
      )}
      {selected && !selected.photo && !selected.text && strokeColours(selected).length > 1 && (
        <div className="pp-note">
          This drawing has {strokeColours(selected).length} line colours. Split it to draw each colour with its own pen.
          <button
            type="button"
            className="pp-fill-only-button"
            disabled={locked}
            onClick={() => {
              const parts = splitByColour(selected).map((part) => {
                // A pen of the same colour, if there is one.
                const match = pens.find((p) => sameColour(p.colour, part.paths[0]?.stroke ?? ""));
                return match ? { ...part, penId: match.id } : part;
              });
              pageDispatch({ type: "split", id: selected.id, items: parts });
            }}
          >
            Split into one drawing per colour
          </button>
        </div>
      )}
      {selected && size && (
        <div className="pp-selected">
          {selected.shape && <ShapePanel item={selected} pageDispatch={pageDispatch} locked={locked} />}
          {selected.photo && <PhotoPanel item={selected} pageDispatch={pageDispatch} locked={locked} />}
          {selected.text && <TextPanel item={selected} pageDispatch={pageDispatch} locked={locked} />}
          <Fold
            id="item-pen"
            sub
            defaultOpen={false}
            title="Pen"
            summary={
              <>
                <PenSwatch pen={penOf(selected)} />
                {penName(penOf(selected))}
              </>
            }
          >
            <span className="pp-pen-pick">
              <PenSwatch pen={penOf(selected)} />
              <select
                value={penOf(selected).id}
                disabled={locked}
                aria-label="Pen for this drawing"
                onChange={(e) => pageDispatch({ type: "pen", id: selected.id, penId: e.target.value })}
              >
                {pens.map((p) => (
                  <option key={p.id} value={p.id}>
                    {penName(p)}
                  </option>
                ))}
              </select>
            </span>
          </Fold>
          {fillable && (
            <Fold
              id="item-fill"
              sub
              defaultOpen={false}
              title="Fill"
              summary={FILL_NAMES[selected.fill?.kind ?? "none"]}
            >
              <FillPanel item={selected} pageDispatch={pageDispatch} locked={locked} />
            </Fold>
          )}
          <Fold
            id="item-size"
            sub
            defaultOpen={false}
            title="Size and position"
            summary={`${round1(size.x)} × ${round1(size.y)} mm`}
          >
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
            <div className="pp-buttons pp-buttons--3">
              <button type="button" disabled={locked} onClick={() => update(rotateItem(selected))}>
                Turn 90°
              </button>
              <button type="button" disabled={locked} onClick={() => update(centreItem(selected, pageSize))}>
                Centre
              </button>
              <button type="button" disabled={locked} onClick={() => update(fitItem(selected, pageSize, marginMm))}>
                Fit page
              </button>
            </div>
          </Fold>
          <button
            type="button"
            className="button-link pp-remove"
            disabled={locked}
            onClick={() => pageDispatch({ type: "remove", id: selected.id })}
          >
            Remove this drawing
          </button>
        </div>
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

// ---- Text ---------------------------------------------------------------------------

function TextPanel({
  item,
  pageDispatch,
  locked,
}: {
  item: PageItem;
  pageDispatch: (a: PageAction) => void;
  locked: boolean;
}) {
  const t = item.text as TextInfo;
  const set = (text: Partial<TextInfo>, scale?: number) =>
    pageDispatch({ type: "textSettings", id: item.id, text, scale });
  const aligns: [Align, string][] = [
    ["left", "Left"],
    ["centre", "Centre"],
    ["right", "Right"],
  ];
  return (
    <div className="pp-photo-panel pp-text-panel">
      <label className="pp-field">
        text
        <textarea
          rows={3}
          dir="auto"
          value={t.text}
          disabled={locked}
          onChange={(e) => set({ text: e.target.value })}
          placeholder="Type here. Enter starts a new line."
        />
      </label>
      <label className="pp-field">
        font
        <select value={t.font} disabled={locked} onChange={(e) => set({ font: e.target.value })}>
          <optgroup label="Handwriting & script: single stroke">
            {SINGLE_LINE_FONTS.filter((f) => f.group === "script").map((f) => (
              <option key={f.file} value={f.file}>
                {f.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Arabic: traced centre line">
            {TRACED_FONTS.filter((f) => f.arabic).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="More handwriting: traced centre line">
            {TRACED_FONTS.filter((f) => !f.arabic).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Print & display: single stroke">
            {SINGLE_LINE_FONTS.filter((f) => f.group === "print").map((f) => (
              <option key={f.file} value={f.file}>
                {f.name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {isTracedFont(t.font) && (
        <>
          <fieldset className="pp-segmented">
            <legend className="pp-sr-only">Letter style</legend>
            {(
              [
                ["line", "One line"],
                ["filled", "Filled"],
              ] as const
            ).map(([style, label]) => (
              <button
                key={style}
                type="button"
                aria-pressed={(t.style ?? "line") === style}
                className={(t.style ?? "line") === style ? "pp-on" : ""}
                disabled={locked}
                onClick={() => {
                  set({ style });
                  if (style === "filled" && !item.fill)
                    pageDispatch({ type: "fill", id: item.id, fill: { kind: "lines", spacingMm: 0.4 } });
                }}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <div className="pp-hint">
            {(t.style ?? "line") === "filled"
              ? "Filled: PenPilot traces each letter's outline and fills it with hatching (see Fill below). Solid-looking letters, like the font on screen."
              : "One line: PenPilot writes the text in this font and traces one pen line through the middle of each letter. Arabic joining and dots are kept."}
          </div>
        </>
      )}
      <NumberField
        label="letter size (mm): height of H, or of ا in Arabic"
        value={t.sizeMm * item.scale}
        disabled={locked}
        onChange={(v) => v > 0 && set({ sizeMm: v }, 1)}
      />
      <SliderField
        label="Letter spacing"
        value={t.letterSpacing}
        min={-0.3}
        max={1.5}
        step={0.05}
        disabled={locked}
        onChange={(v) => set({ letterSpacing: v })}
      />
      <SliderField
        label="Line spacing"
        value={t.lineSpacing}
        min={0.6}
        max={3}
        step={0.05}
        disabled={locked}
        onChange={(v) => set({ lineSpacing: v })}
      />
      <fieldset className="pp-segmented">
        <legend className="pp-sr-only">Alignment</legend>
        {aligns.map(([a, label]) => (
          <button
            key={a}
            type="button"
            aria-pressed={t.align === a}
            className={t.align === a ? "pp-on" : ""}
            disabled={locked}
            onClick={() => set({ align: a })}
          >
            {label}
          </button>
        ))}
      </fieldset>
      {t.error && <div className="pp-photo-status pp-photo-status--error">{t.error}</div>}
    </div>
  );
}

// ---- Fill ----------------------------------------------------------------------------

// ---- Shapes -------------------------------------------------------------------------

function ShapePanel({
  item,
  pageDispatch,
  locked,
}: {
  item: PageItem;
  pageDispatch: (a: PageAction) => void;
  locked: boolean;
}) {
  const shape = item.shape;
  if (!shape) return null;
  const set = (change: Partial<NonNullable<PageItem["shape"]>>) =>
    pageDispatch({ type: "shape", id: item.id, shape: change });
  return (
    <div className="pp-photo-panel pp-shape-panel">
      <div className="pp-fields">
        {shape.kind === "rect" && (
          <NumberField
            label="corner radius (mm)"
            value={shape.radius}
            disabled={locked}
            onChange={(v) => set({ radius: Math.max(0, v) })}
          />
        )}
        <label className="pp-field">
          lines
          <select value={shape.lines} disabled={locked} onChange={(e) => set({ lines: Number(e.target.value) })}>
            {Array.from({ length: MAX_SHAPE_LINES }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "1 line" : `${n} lines`}
              </option>
            ))}
          </select>
        </label>
        {shape.lines > 1 && (
          <NumberField
            label="gap between lines (mm)"
            value={shape.gap}
            disabled={locked}
            onChange={(v) => set({ gap: Math.max(0.1, v) })}
          />
        )}
      </div>
      <div className="pp-hint">Drag the corner dot to stretch it. Use fill below to hatch it in.</div>
    </div>
  );
}

function FillPanel({
  item,
  pageDispatch,
  locked,
}: {
  item: PageItem;
  pageDispatch: (a: PageAction) => void;
  locked: boolean;
}) {
  const { shapes } = itemDrawnPaths(item);
  const fill = item.fill;
  const kind: FillKind = fill?.kind ?? "none";
  const set = (f: Partial<FillInfo> | null) => pageDispatch({ type: "fill", id: item.id, fill: f });
  if (shapes === 0) {
    return item.fill ? <div className="pp-hint">No closed shapes to fill in this drawing.</div> : null;
  }
  return (
    <div className="pp-photo-panel pp-fill-panel">
      <label className="pp-field">
        fill ({shapes.toLocaleString()} closed {shapes === 1 ? "shape" : "shapes"})
        <select
          value={kind}
          disabled={locked}
          onChange={(e) => {
            const k = e.target.value as FillKind;
            set(k === "none" ? null : { kind: k });
          }}
        >
          <option value="none">No fill (outlines only)</option>
          <option value="lines">Hatch: lines</option>
          <option value="cross">Hatch: cross-hatch</option>
          <option value="concentric">Concentric (shrinking outlines)</option>
        </select>
      </label>
      {fill && kind !== "none" && (
        <>
          <SliderField
            label="Line spacing (mm)"
            value={fill.spacingMm}
            min={0.2}
            max={5}
            step={0.05}
            disabled={locked}
            onChange={(v) => set({ spacingMm: v })}
          />
          {kind !== "concentric" && (
            <SliderField
              label="Angle (°)"
              value={fill.angle}
              min={0}
              max={180}
              step={5}
              disabled={locked}
              onChange={(v) => set({ angle: v })}
            />
          )}
          <label className="pp-checkbox">
            <input
              type="checkbox"
              checked={fill.outline}
              disabled={locked}
              onChange={(e) => set({ outline: e.target.checked })}
            />
            Draw the outlines too
          </label>
          <div className="pp-hint">For a solid look, set the spacing to about your pen's line width.</div>
        </>
      )}
    </div>
  );
}
