# Changelog

What changed in each version of PenPilot. Installers are on the
[releases page](https://github.com/Ava-AgentOne/penpilot-releases/releases); the test guide
for each step is in [`docs/test-guides/`](docs/test-guides/).

## 1.0.4 (2026-10-20)

A clearer side panel: open sections were hard to tell apart.

- **Colour-coded cards:** Pen, Paper, Drawings and Advanced are white cards on a light lavender
  panel, each with its own coloured edge and icon (pen red, paper teal, drawings purple,
  advanced grey).
- **Pinned headers:** an open section's header stays at the top of the panel while you scroll
  through it, so you always know which section you're in.
- **Tidier Advanced:** grouped into Preview, Plotter, Line clean-up and Movement, with one
  left-aligned "name … value" row per setting (the labels used to be centred and wrap).

## 1.0.3 (2026-10-20)

Tidy-up release; PenPilot works exactly as in 1.0.2.

- The app's author, and the "Company" shown in the Windows file details, is now Ava-AgentOne.
- Personal details removed from the project's history and test guides.

## 1.0.2 (2026-10-20)

Windows updates fixed, after the first test on a Windows PC.

- **Windows updates now finish:** a small hidden helper waits for PenPilot to close, runs the
  new installer silently and opens PenPilot again (or swaps the portable .exe). In 1.0.0 and
  1.0.1 the wait never ended, so PenPilot closed and the update never ran; the installer's own
  "start afterwards" didn't reopen it either. Each step is logged in `update.log`.
- If the helper can't start, PenPilot stays open and says so.
- Windows copies on 1.0.0 or 1.0.1 aren't offered updates (their updater is the broken one):
  install 1.0.2 once by hand. The update file lists Windows files under new names for this.
- Thin scrollbars in PenPilot's colours on Windows.
- Plotter check's technical details say which serial ports were refused.
- Releases can go out as a test release first (`publish-release.mjs --prerelease`, then
  `--promote`).

## 1.0.1 (2026-10-19)

Fixes from a full audit of the app.

- **Plotter unplugged or switched off mid-plot:** the plot now stops cleanly, PenPilot shows the
  plotter as disconnected, and "Continue from line" works once it's back (it used to wait forever).
- **Motors off**, the **paper** and the **Advanced** settings are locked during a plot (also while
  paused or waiting for a pen), so the carriage and the plan can't change under a running plot.
- **Pasting:** text pasted into a text box stays text; only SVG pasted onto the page becomes a drawing.
- **Project files** are range-checked when opened (sizes, fill spacing, text, paper), and very
  large files are refused, so a damaged file can't freeze PenPilot.
- **Security hardening:** browser permission requests are refused (except the plotter), every
  desktop request must come from PenPilot's own screens, and Electron's fuses are set (no
  "run as Node", no outside Node options or debugger, only the checked app.asar).
- The Mac plotter connection is closed if the screen ever crashes or reloads.
- The update message says when an update will finish on the next close.
- Build tools: removed saxi's unused GitHub Pages tool; the type check is now clean.

## 1.0.0 (2026-10-19)

The first full release.

- **Automatic updates:** PenPilot checks for a new version when it opens and every few hours,
  shows what's new, and installs it with **Update now** (Mac: swaps itself and reopens;
  Windows: runs the new installer). **Help → Check for updates…**
- Releases are published with the installers, the source code of that version and the update file.

## 0.9.3 (2026-10-19)

- **Workspace toolbar** above the page: undo, redo, save, duplicate, remove, zoom, fit, and
  show/hide the pen-up moves.
- **Undo / redo** for every change on the page (quick repeats count as one step).
- **Zoom** with the buttons, ⌘+ / ⌘− / ⌘0, or by pinching; the page scrolls when zoomed in.

## 0.9.2 (2026-10-19)

- Click the **coloured dot** beside a drawing to choose its pen.

## 0.9.1 (2026-10-18)

- A **plot tick** beside each drawing: unticked drawings stay on the page but aren't plotted.
- After a plot, **Untick them** unticks what was just drawn, so new text can be plotted alone,
  lined up with what's already on the paper.

## 0.9.0 (2026-10-18)

- **Tidier side panel:** New / Open / Save / Export in the **File menu**; Pen, Paper, Drawings
  and Advanced fold up with a one-line summary; one **+ Add** menu; Frame and Plot side by side.

## 0.8.0 (2026-10-18)

- **App icon**, a **welcome guide** on first open (and from Help).
- **Double-click a project** to open it; only one PenPilot runs at a time.
- Plain wording for the advanced settings; **Motors off** to move the carriage by hand.

## 0.7.0 (2026-10-18)

- **Projects:** save and reopen the whole page as a `.penpilot` file (photos keep their exact lines).
- **Export SVG**, one layer per pen.
- **Shapes:** rectangles, circles and a page border.

## 0.6.0 (2026-10-18)

- **Saved pens**, each with its own heights, speed, line width and colour; a **test square**.
- **Several pens on one page:** PenPilot stops and asks for the next pen.
- **Stop, then continue from any line** (for example after a pen runs dry).
- Lines shown at the pen's real width.

## 0.5.0 (2026-10-18)

- **Hatch fill** for shapes and letters: lines, cross-hatch or concentric; holes stay empty.
- **Filled letters** for the traced fonts.

## 0.4.0 and 0.4.1 (2026-10-18)

- **Single-line text** in 41 single-stroke fonts, 22 of them handwriting.
- **Arabic and more handwriting fonts**, traced into one pen line per letter.

## 0.3.0 and 0.3.1 (2026-10-18)

- **Tracing:** pictures become single pen lines (centre lines) or outlines.
- **Photo styles:** 23 Plotterfun styles turn photos into line art.

## 0.2.0 (2026-10-18)

- **Page editor:** several drawings on one page; move, resize, turn; paper sizes, portrait or
  landscape (plotted sideways when needed).
- **Frame:** the lifted pen traces the drawing's area; live progress while plotting.

## 0.1.0 (2026-10-18)

- PenPilot as a **standalone app** for Mac and Windows, built on saxi.
- **Plotter check** on start-up; direct USB connection on the Mac; **Reverse pen direction**.
