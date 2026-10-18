/**
 * Small building blocks for PenPilot's side panel: folding sections (which
 * remember whether they're open), a button with a drop-down menu, and an ⓘ
 * that shows a tip on hover.
 */

import React, { useEffect, useRef, useState } from "react";

const FOLD_KEY = "penpilot.fold.";

function loadOpen(id: string, dflt: boolean): boolean {
  try {
    const v = window.localStorage.getItem(FOLD_KEY + id);
    return v === null ? dflt : v === "1";
  } catch {
    return dflt;
  }
}

/**
 * A section that folds up to a one-line header. `summary` shows on the right
 * while it's closed (e.g. "A4 · landscape · 20 mm"). `sub` is the smaller kind
 * used inside a drawing's settings.
 */
export function Fold({
  id,
  title,
  summary,
  defaultOpen = true,
  sub = false,
  children,
}: {
  id: string;
  title: React.ReactNode;
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  sub?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(() => loadOpen(id, defaultOpen));
  const toggle = () => {
    setOpen(!open);
    try {
      window.localStorage.setItem(FOLD_KEY + id, open ? "0" : "1");
    } catch {
      // ignore
    }
  };
  return (
    <section className={`pp-fold${sub ? " pp-fold--sub" : ""}${open ? " pp-fold--open" : ""}`}>
      <button type="button" className="pp-fold-head" aria-expanded={open} onClick={toggle}>
        <span className="pp-fold-title">{title}</span>
        {!open && summary !== undefined && <span className="pp-fold-summary">{summary}</span>}
        <span className="pp-fold-chevron" aria-hidden="true">
          ›
        </span>
      </button>
      {open && <div className="pp-fold-body">{children}</div>}
    </section>
  );
}

export interface MenuItem {
  label: React.ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Draw a line above this item. */
  separator?: boolean;
}

/** A button that opens a short menu below it. */
export function MenuButton({
  label,
  items,
  disabled,
  className,
  title,
}: {
  label: React.ReactNode;
  items: MenuItem[];
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className={`pp-menu-button${className ? ` ${className}` : ""}`} ref={box}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen(!open)}
      >
        {label} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="pp-menu" role="menu">
          {items.map((item, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
              key={i}
              type="button"
              role="menuitem"
              className={item.separator ? "pp-menu-sep" : undefined}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A small ⓘ with a tip on hover (instead of a paragraph of help text). */
export const Info = React.memo(function Info({ text }: { text: string }) {
  return (
    <span className="pp-info" title={text} role="img" aria-label={text}>
      ⓘ
    </span>
  );
});
