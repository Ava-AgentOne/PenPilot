/**
 * PenPilot's pen controls: the saved pens (pens.ts) and their test buttons,
 * the "put in the next pen" card shown when a plot changes pen, the pen order
 * in the plot section, and "continue from line" after a stopped plot.
 */

import React, { useEffect, useRef, useState } from "react";
import type { BaseDriver } from "../drivers.js";
import type { Device } from "../planning.js";
import { newPen, type Pen, penName } from "./pens.js";

export const PenSwatch = React.memo(function PenSwatch({ pen }: { pen: Pen }) {
  return <span className="pp-swatch" style={{ background: pen.colour }} aria-hidden="true" />;
});

/** A number box that only takes values in range, without fighting the typing. */
function PenNumber({
  label,
  value,
  min,
  max,
  step,
  disabled,
  title,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  title?: string;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="pp-field" title={title}>
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value !== "" && Number.isFinite(v) && v >= min && v <= max) onChange(v);
        }}
        onBlur={() => setText(String(value))}
      />
    </label>
  );
}

export function PensPanel({
  pens,
  setPens,
  penId,
  setPenId,
  driver,
  device,
  canMovePen,
  locked,
  testing,
  canTest,
  onTest,
  penLiftReversed,
  setPenLiftReversed,
}: {
  pens: Pen[];
  setPens: (pens: Pen[]) => void;
  penId: string;
  setPenId: (id: string) => void;
  driver: BaseDriver | null;
  device: Device;
  /** The pen can be raised/lowered now (connected, not drawing). */
  canMovePen: boolean;
  /** Settings can't change while a plot is running. */
  locked: boolean;
  testing: boolean;
  canTest: boolean;
  onTest: (pen: Pen) => void;
  penLiftReversed: boolean;
  setPenLiftReversed: (v: boolean) => void;
}) {
  const pen = pens.find((p) => p.id === penId) ?? pens[0];
  // Where the pen was last sent, so changing a height moves it there live.
  const lastMove = useRef<"up" | "down" | null>(null);
  const move = (where: "up" | "down", pct: number) => {
    lastMove.current = where;
    driver?.setPenHeight(device.penPctToPos(pct), 1000);
  };
  const update = (change: Partial<Pen>) => {
    setPens(pens.map((p) => (p.id === pen.id ? { ...p, ...change } : p)));
    if (!canMovePen) return;
    if (change.upHeight !== undefined && lastMove.current === "up") move("up", change.upHeight);
    if (change.downHeight !== undefined && lastMove.current === "down") move("down", change.downHeight);
  };
  const remove = () => {
    const others = pens.filter((p) => p.id !== pen.id);
    if (others.length === 0) return;
    const msg = `Remove “${penName(pen)}”? Drawings that use it will use “${penName(others[0])}” instead.`;
    if (!window.confirm(msg)) return;
    setPens(others);
    setPenId(others[0].id);
  };
  return (
    <div className="pp-pens">
      <div className="pp-pen-pick">
        <PenSwatch pen={pen} />
        <select
          value={pen.id}
          onChange={(e) => {
            lastMove.current = null;
            setPenId(e.target.value);
          }}
          aria-label="Pen"
        >
          {pens.map((p) => (
            <option key={p.id} value={p.id}>
              {penName(p)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="pp-small-button"
          disabled={locked}
          onClick={() => {
            const p = newPen(pens, pen);
            setPens([...pens, p]);
            setPenId(p.id);
          }}
          title="Add another pen, starting from this pen's settings"
        >
          New pen
        </button>
      </div>
      <div className="pp-pen-card" style={{ borderLeftColor: pen.colour }}>
        <div className="pp-pen-name">
          <label className="pp-field">
            name
            <input type="text" value={pen.name} disabled={locked} onChange={(e) => update({ name: e.target.value })} />
          </label>
          <label className="pp-field pp-colour" title="The colour this pen's drawings show in on screen">
            colour
            <input
              type="color"
              value={pen.colour}
              disabled={locked}
              onChange={(e) => update({ colour: e.target.value })}
            />
          </label>
        </div>
        <div className="pp-fields">
          <PenNumber
            label="up height (%)"
            value={pen.upHeight}
            min={0}
            max={100}
            step={1}
            disabled={locked}
            onChange={(v) => update({ upHeight: v })}
          />
          <PenNumber
            label="down height (%)"
            value={pen.downHeight}
            min={0}
            max={100}
            step={1}
            disabled={locked}
            onChange={(v) => update({ downHeight: v })}
          />
          <PenNumber
            label="speed (mm/s)"
            title="How fast the pen moves while drawing. Slow down for pens that skip or for thick ink."
            value={pen.speed}
            min={1}
            max={500}
            step={5}
            disabled={locked}
            onChange={(v) => update({ speed: v })}
          />
          <PenNumber
            label="line width (mm)"
            title="How wide this pen's line is on paper. Used for the on-screen preview."
            value={pen.widthMm}
            min={0.05}
            max={10}
            step={0.05}
            disabled={locked}
            onChange={(v) => update({ widthMm: v })}
          />
        </div>
        <div className="pp-buttons pp-pen-buttons">
          <button type="button" disabled={!canMovePen} onClick={() => move("up", pen.upHeight)}>
            Raise pen
          </button>
          <button type="button" disabled={!canMovePen} onClick={() => move("down", pen.downHeight)}>
            Lower pen
          </button>
        </div>
        <button
          type="button"
          className="pp-test-button"
          disabled={!canTest}
          onClick={() => onTest(pen)}
          title="Draw a small square in the corner of the paper by the pen's home position"
        >
          {testing ? "Drawing test square…" : "Test square"}
        </button>
        <div className="pp-hint">
          After Lower pen, changing the heights moves the pen as you type. Test square draws a 10 mm square in the
          paper's corner, half filled: the filled half should look solid at the right line width.
        </div>
        {pens.length > 1 && (
          <button type="button" className="button-link pp-forget-size" disabled={locked} onClick={remove}>
            remove “{penName(pen)}”
          </button>
        )}
      </div>
      <label
        className="pp-checkbox"
        title="Tick this if pressing 'Raise pen' lowers the pen on your plotter. Common on AxiDraw-compatible clones."
      >
        <input
          type="checkbox"
          checked={penLiftReversed}
          disabled={locked}
          onChange={(e) => setPenLiftReversed(e.target.checked)}
        />
        Reverse pen direction
      </label>
    </div>
  );
}

/** The pens a plot uses, in order, in the plot section. ▲ plots that pen earlier. */
export function PlotPens({
  used,
  onEarlier,
  locked,
}: {
  used: Pen[];
  onEarlier: (i: number) => void;
  locked: boolean;
}) {
  if (used.length === 0) return null;
  if (used.length === 1) {
    return (
      <div className="pp-plot-pens">
        Pen: <PenSwatch pen={used[0]} /> {penName(used[0])}
      </div>
    );
  }
  return (
    <div className="pp-plot-pens">
      <div>{used.length} pens, in this order (PenPilot stops before each new pen):</div>
      <ol>
        {used.map((p, i) => (
          <li key={p.id}>
            <PenSwatch pen={p} /> <span className="pp-plot-pen-name">{penName(p)}</span>
            {i > 0 && (
              <button
                type="button"
                className="pp-earlier"
                disabled={locked}
                onClick={() => onEarlier(i)}
                title="Plot this pen earlier"
                aria-label={`Plot ${penName(p)} earlier`}
              >
                ▲
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Shown while a plot waits for the next pen. */
export function PenChangeCard({
  pen,
  number,
  of,
  canMovePen,
  onRaise,
  onLower,
  onContinue,
  onStop,
}: {
  pen: Pen;
  number: number;
  of: number;
  canMovePen: boolean;
  onRaise: () => void;
  onLower: () => void;
  onContinue: () => void;
  onStop: () => void;
}) {
  const continueButton = useRef<HTMLButtonElement>(null);
  useEffect(() => continueButton.current?.focus(), []);
  return (
    <div className="pp-pen-change" role="alertdialog" aria-labelledby="pp-pen-change-title">
      <div className="pp-pen-change-step">
        Pen {number} of {of}
      </div>
      <div id="pp-pen-change-title" className="pp-pen-change-title">
        Put in <PenSwatch pen={pen} /> {penName(pen)}
      </div>
      <p>
        The carriage is parked in its home corner with the pen lifted. Swap the pen, then press{" "}
        <strong>Continue</strong>. Lower pen and Raise pen use this pen's heights, to help you fit it.
      </p>
      <div className="pp-buttons">
        <button type="button" disabled={!canMovePen} onClick={onLower}>
          Lower pen
        </button>
        <button type="button" disabled={!canMovePen} onClick={onRaise}>
          Raise pen
        </button>
      </div>
      <div className="pp-buttons pp-pen-change-go">
        <button type="button" ref={continueButton} className="plot-button" onClick={onContinue}>
          Continue
        </button>
        <button type="button" onClick={onStop}>
          Stop plot
        </button>
      </div>
    </div>
  );
}

/** After a stop: carry on from a chosen line instead of starting again. */
export function ContinuePanel({
  done,
  total,
  from,
  setFrom,
  canPlot,
  onContinue,
  onForget,
}: {
  /** Lines finished before the stop. */
  done: number;
  total: number;
  /** Line to continue from, 0-based. */
  from: number;
  setFrom: (line: number) => void;
  canPlot: boolean;
  onContinue: () => void;
  onForget: () => void;
}) {
  const clamp = (n: number) => Math.max(0, Math.min(total - 1, n));
  return (
    <div className="pp-continue">
      <div className="pp-continue-title">
        Stopped after {done.toLocaleString()} of {total.toLocaleString()} lines.
      </div>
      <label className="pp-slider">
        <span className="pp-slider-label">
          <span>Continue from line</span>
          <span className="pp-slider-value">{(from + 1).toLocaleString()}</span>
        </span>
        <input
          type="range"
          min={1}
          max={total}
          step={1}
          value={from + 1}
          onChange={(e) => setFrom(clamp(Number(e.target.value) - 1))}
        />
      </label>
      <div className="pp-continue-steps">
        <button type="button" onClick={() => setFrom(clamp(from - 10))}>
          ◀ 10
        </button>
        <button type="button" onClick={() => setFrom(clamp(from - 1))}>
          ◀ 1
        </button>
        <button type="button" onClick={() => setFrom(clamp(from + 1))}>
          1 ▶
        </button>
        <button type="button" onClick={() => setFrom(clamp(done))}>
          where it stopped
        </button>
      </div>
      <div className="pp-hint">Lines before it show in teal. If the pen ran dry, go back to the first faint line.</div>
      <button type="button" className="plot-button pp-continue-button" disabled={!canPlot} onClick={onContinue}>
        Continue from line {(from + 1).toLocaleString()}
      </button>
      <button type="button" className="button-link pp-forget-size" onClick={onForget}>
        forget it (Plot starts from the beginning)
      </button>
    </div>
  );
}

/** A short two-note chime, so a pen change is noticed from across the room. */
export function chime(): void {
  try {
    const ctx = new AudioContext();
    const t = ctx.currentTime;
    [660, 880].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const at = t + i * 0.2;
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.25, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start(at);
      o.stop(at + 0.65);
    });
    setTimeout(() => void ctx.close(), 1500);
  } catch {
    // No sound available: the card on screen is enough.
  }
}
