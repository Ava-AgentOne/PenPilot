/**
 * PenPilot's welcome guide: a few short pages on how a plot goes, shown the
 * first time PenPilot opens and again from Help.
 */

import React, { useEffect, useState } from "react";

const SEEN_KEY = "penpilot.welcomed";

export function welcomeSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true; // no storage: don't keep showing it
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // ignore
  }
}

/** The app icon (desktop/scripts/make-icons.cjs draws the same design). */
export const AppIcon = React.memo(function AppIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 160 160" aria-hidden="true">
      <rect x="0" y="0" width="160" height="160" rx="36" fill="#604987" />
      <path
        d="M102 124 C90 108 76 140 62 124 S36 110 26 126"
        // Inline: saxi's style.css paints every <path> black.
        style={{ fill: "none", stroke: "#75D5CD", strokeWidth: 5, strokeLinecap: "round" }}
      />
      <g fill="#604987" stroke="#fff" strokeWidth="3.5">
        <rect x="8" y="36" width="80" height="12" rx="2" />
        <rect x="84" y="28" width="34" height="44" rx="4" />
        <rect x="90" y="17" width="22" height="11" rx="2" />
        <rect x="97" y="50" width="10" height="60" rx="3" />
      </g>
      <polygon points="97,110 107,110 102,122" fill="#DE7272" stroke="#DE7272" strokeWidth="2" strokeLinejoin="round" />
      <g fill="#604987" stroke="#fff" strokeWidth="3">
        <rect x="93" y="62" width="18" height="7" rx="1.5" />
        <rect x="93" y="80" width="18" height="7" rx="1.5" />
      </g>
    </svg>
  );
});

const PAGES: { title: string; body: React.ReactNode }[] = [
  {
    title: "Welcome to PenPilot",
    body: (
      <>
        <p>
          PenPilot turns drawings, photos and text into pen lines and plots them on your AxiDraw. Here's how a plot
          goes, in five steps.
        </p>
        <p>You can open this guide again any time with the ? button, or Help in the menu bar.</p>
      </>
    ),
  },
  {
    title: "1. Home corner and paper",
    body: (
      <>
        <p>
          Press <strong>Motors off</strong> (under Pen), then slide the pen carriage by hand to its{" "}
          <strong>home corner</strong>: the top-left corner of the area it can reach. PenPilot measures everything from
          there, and drives back there after every plot.
        </p>
        <p>
          Lay the paper so its top-left corner sits under the pen. If the page is plotted sideways (A4 portrait, say),
          PenPilot shows a note telling you how to put the sheet in.
        </p>
      </>
    ),
  },
  {
    title: "2. Your pen",
    body: (
      <>
        <p>
          In <strong>Pen</strong>, press <strong>Lower</strong>, open <strong>Edit pen settings</strong> and change the{" "}
          <strong>down height</strong> until the tip just touches the paper. <strong>Test square</strong> draws a small
          square in the corner to check.
        </p>
        <p>
          Press <strong>+</strong> to save each pen you own, with its own heights, speed and colour. Drawings can use
          different pens: PenPilot stops and asks you to swap.
        </p>
      </>
    ),
  },
  {
    title: "3. Your page",
    body: (
      <p>
        Under <strong>Drawings</strong>, use <strong>+ Add</strong> for a drawing or photo (pictures are traced into
        lines), text (handwriting and Arabic fonts) or a shape. Drag to move, drag the corner dot to resize. Closed
        shapes and letters can be <strong>filled</strong> with hatching.
      </p>
    ),
  },
  {
    title: "4. Frame, then Plot",
    body: (
      <>
        <p>
          <strong>Frame</strong> moves the lifted pen round the area the drawing covers, so you can see where it lands
          before any ink goes down. <strong>Plot</strong> draws it, and the page shows the progress.
        </p>
        <p>
          <strong>Pause</strong> lifts the pen. <strong>Stop</strong> sends it home, and you can then continue from any
          line, for example if a pen ran dry.
        </p>
      </>
    ),
  },
  {
    title: "5. Save your work",
    body: (
      <p>
        <strong>File → Save</strong> keeps the whole page as a project you can open again later (or double-click).{" "}
        <strong>File → Export SVG</strong> saves the lines for other programs. Happy plotting!
      </p>
    ),
  },
];

export function WelcomeGuide({ onClose, version }: { onClose: () => void; version: string | null }) {
  const [n, setN] = useState(0);
  const close = () => {
    markSeen();
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") setN((i) => Math.min(PAGES.length - 1, i + 1));
      else if (e.key === "ArrowLeft") setN((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const page = PAGES[n];
  const last = n === PAGES.length - 1;
  return (
    <div className="pp-overlay pp-welcome-overlay" role="dialog" aria-modal="true" aria-labelledby="pp-welcome-title">
      <div className="pp-card pp-welcome">
        <button type="button" className="pp-welcome-close" aria-label="Close" onClick={close}>
          ×
        </button>
        <div className="pp-welcome-icon">
          <AppIcon size={n === 0 ? 96 : 56} />
        </div>
        <div id="pp-welcome-title" className="pp-card-title">
          {page.title}
        </div>
        <div className="pp-welcome-body">{page.body}</div>
        <div className="pp-welcome-dots" aria-hidden="true">
          {PAGES.map((p, i) => (
            <span key={p.title} className={i === n ? "pp-on" : ""} />
          ))}
        </div>
        <div className="pp-welcome-buttons">
          <button type="button" disabled={n === 0} onClick={() => setN(n - 1)}>
            Back
          </button>
          {last ? (
            <button type="button" className="plot-button" onClick={close}>
              Start
            </button>
          ) : (
            <button type="button" className="plot-button" onClick={() => setN(n + 1)}>
              Next
            </button>
          )}
        </div>
        {version && <div className="pp-welcome-version">PenPilot {version}, based on saxi</div>}
      </div>
    </div>
  );
}
