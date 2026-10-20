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

// Section icon outlines (24 x 24, drawn with the current text colour), in the
// same style as the workspace toolbar's.
const SECTION_ICONS = {
  pen: ["M4 20h4L19 9l-4-4L4 16z", "M13.5 6.5l4 4"],
  paper: ["M6 3h8l4 4v14H6z", "M14 3v4h4"],
  drawings: ["M3 14h7v7H3z", "M17.5 10.5a3.5 3.5 0 1 0 0-7a3.5 3.5 0 1 0 0 7z", "M14 21l3.5-7 3.5 7z"],
  advanced: ["M4 6h8", "M16 6h4", "M14 4v4", "M4 12h2", "M10 12h10", "M8 10v4", "M4 18h11", "M19 18h1", "M17 16v4"],
};
export type SectionIcon = keyof typeof SECTION_ICONS;

function SectionIconSvg({ name }: { name: SectionIcon }) {
  return (
    <svg className="pp-fold-icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      {SECTION_ICONS[name].map((d) => (
        // Inline: saxi's style.css paints every <path> black.
        <path
          key={d}
          d={d}
          style={{ fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}
        />
      ))}
    </svg>
  );
}

/**
 * A section that folds up to a one-line header. `summary` shows on the right
 * while it's closed (e.g. "A4 · landscape · 20 mm"). `sub` is the smaller kind
 * used inside a drawing's settings. `icon` makes it one of the side panel's
 * colour-coded cards (pen red, paper teal, drawings purple, advanced grey),
 * whose header stays in view while you scroll through it.
 */
export function Fold({
  id,
  title,
  summary,
  icon,
  defaultOpen = true,
  sub = false,
  children,
}: {
  id: string;
  title: React.ReactNode;
  summary?: React.ReactNode;
  icon?: SectionIcon;
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
    <section
      className={`pp-fold${sub ? " pp-fold--sub" : ""}${icon ? " pp-fold--card" : ""}${open ? " pp-fold--open" : ""}`}
      data-tone={icon}
    >
      <button type="button" className="pp-fold-head" aria-expanded={open} onClick={toggle}>
        {icon && <SectionIconSvg name={icon} />}
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
  ariaLabel,
  caret = true,
}: {
  label: React.ReactNode;
  items: MenuItem[];
  disabled?: boolean;
  className?: string;
  title?: string;
  ariaLabel?: string;
  /** Show the ▾ after the label. */
  caret?: boolean;
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
        aria-label={ariaLabel}
        onClick={() => setOpen(!open)}
      >
        {label}
        {caret && <span aria-hidden="true"> ▾</span>}
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
