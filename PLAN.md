# PenPilot: Plan

*Draft 2, 2026-10-18. A standalone pen-plotter app for the AxiDraw V3.*

One app for the AxiDraw V3: put things on a page (a photo, text, a logo or SVG), turn them into pen lines, preview them, show on the paper where they'll go, then plot. No Inkscape.

It's built on two free projects:
- **Saxi** handles the plotting. It already has paper sizes, preview, time estimates, pause/resume, and pen and speed settings.
- **Plotterfun** turns photos into line art. It has 22 ready-made styles.

---

## The screen

```
┌───────────────┬──────────────────────────────────┬───────────────────────┐
│ ADD           │                                  │ SELECTED ITEM         │
│  + Image      │      ┌───────────────────┐       │  Style: Squiggle  ▾   │
│  + Text       │      │ A4 · portrait     │       │  Lines ───●────       │
│  + SVG / logo │      │  ┌ ─ ─ ─ ─ ─ ┐    │       │  Detail ──●─────      │
│  + Shape      │      │   [ photo ]       │       │  Fill: Hatch 45° ▾    │
│               │      │  └ ─ ─ ─ ─ ─ ┘    │       │                       │
│ ON THE PAGE   │      │   Hello there     │       ├───────────────────────┤
│  ▣ photo  ⬤ blk│     │                   │       │ PLOT                  │
│  ▣ text   ⬤ red│     └───────────────────┘       │  Pen: Fineliner 0.3 ▾ │
│               │   drag · resize · rotate         │  [Frame] [Plot] [Pause]│
│               │                                  │  ~14 min · 62% done   │
└───────────────┴──────────────────────────────────┴───────────────────────┘
```

- **Left:** add things, plus a list of what's on the page and which pen colour each uses.
- **Middle:** the paper at true size. You drag, resize and rotate items. A dashed line shows the margins.
- **Right:** settings for whatever is selected, and the plot controls.

---

## Your five features

### 1. Image to lines
- **Photo styles** (from Plotterfun): Squiggle, Spiral, Stipple (dots), Line draw, Waves, Halftone, Mosaic, Woven, and more, 22 in total. Each has sliders and a live preview.
- **Trace mode for logos and black-and-white artwork:** it traces the edges of the shapes. You can then fill them with hatching (feature 3).
- **Before converting**, you can crop, rotate, change brightness or contrast, and invert the image.

### 2. Text in one pass (single-line fonts)
- A normal font gets drawn as an outline. The pen goes around the edge of every letter, so letters come out hollow and take twice as long.
- **Single-line fonts** draw each letter as one stroke, like handwriting. 19 free ones are included: sans, serif, script/handwriting, gothic and technical.
- You can set the size in mm, letter spacing, line spacing and alignment, and write several lines.
- Normal fonts still work, including Arabic. They're drawn as outlines, and you can **hatch-fill** them to get solid, bold letters.

### 3. Fill shapes with hatch
- Any closed shape can be filled: traced logos, SVG shapes, outline text, rectangles and circles.
- **Fill types:** straight lines, cross-hatch (two directions), or concentric (shrinking outlines, like contour lines). You choose the angle and spacing.
- You can keep or remove the outline around the fill.
- **Spacing starts at your pen's width**, so a fill looks solid without gaps or overlapping lines.

### 4. Paper size
- Saxi already has A3, A4, A5, A6, US Letter, Legal, 5×7, 6×8, 11×14 and Custom (mm), plus portrait/landscape and margins.
- **New:** the app knows the V3 can only reach **300 × 218 mm** and warns you if the drawing goes past that. A4 fits; A3 doesn't fit on a V3.
- **New:** save your own sizes, e.g. "Card 10×15" or "Envelope DL".

### 5. Show the print area by moving the pen ("Frame")
- **Frame button:** with the pen *lifted*, the plotter moves around the rectangle the drawing will cover, so you can see where it lands and shift the paper before committing ink. It works like the "frame" button on a laser engraver.
- **Options:** go around once, or keep looping until you press Stop. Pause at each corner. Optionally make tiny pen ticks at the corners.
- **On screen while plotting:** finished lines change colour, the remaining lines stay grey, and you see the percentage done and time left.

---

## Extra features I'd add

1. **Page layout.** Combine items on one page (photo + caption + border), with snap-to-centre and alignment.
2. **Several pen colours.** Each item gets a pen colour. The app plots one colour, pauses and tells you to put in the next pen (e.g. "red"), then continues.
3. **Pen presets.** Save the pen height and speed for each pen you own (fineliner, Sharpie, gel pen, brush pen) and pick it from a list.
4. **Pen test buttons.** Raise/lower the pen and draw a small test square to tune the height before a real plot.
5. **Resume after a stop.** If a pen dries up mid-plot: stop, swap the pen, and continue from the line where it stopped rather than from the start.
6. **True pen-width preview.** See how dark the drawing and hatching will look before using paper.
7. **Automatic line clean-up.** Remove tiny specks, join broken lines, and reorder lines so the pen travels less in the air. Saxi already does this; it goes under "Advanced".
8. **Save and reopen projects**, and export to SVG.
9. **Firmware check on connect.** Warn if the plotter's firmware is too old for the most accurate mode.
10. **Simple shapes** (rectangle, circle, border frame) to add to a page. Combined with hatching, they're useful for cards and certificates.

---

## Standalone: everything in one install

You install one thing and it works. You never need to install Node.js, Python, Inkscape, Saxi, or anything else.

| | Mac | Windows |
|---|---|---|
| **What you download** | `.dmg`: drag the app into Applications | `.exe` installer, **or** a portable version that runs without installing (e.g. from a USB stick) |
| **What's inside** | The app, its own built-in engine, the plotter connection code, the fonts and the photo styles | Same, plus the AxiDraw USB driver and the official firmware updater |
| **USB driver** | Not needed; macOS has it built in | Windows 10/11: not needed, it sets up automatically. Windows 8 or older: the app installs the bundled driver for you (one admin prompt) |

**"Plotter check" on startup.** The app looks for the AxiDraw and tells you plainly what's wrong if it can't connect:
- **Not found:** check the USB cable and port.
- **Found, but the motor power adapter isn't plugged in:** the board can report its own voltage, and Saxi already reads it.
- **Windows shows it as an unknown device:** an **Install driver** button fixes it.
- **Firmware is old:** it shows the version you have and the version needed. On Windows it runs the official updater for you (latest firmware is v3.1.7). On the Mac it guides you to do the update once from the Windows PC, because the official updater is Windows-only.

**First-open warning.** Because the app isn't signed with a paid developer certificate, both systems show a security warning the first time you open it:
- Mac: right-click the app → **Open**.
- Windows: **More info** → **Run anyway**.

You only do this once. Signing costs money every year (Apple $99/yr) and only matters if you share the app.

**How each version is made.** The Mac version is built here on your Mac. The Windows version is built automatically by GitHub on a real Windows machine (free for a private repo).

## How it gets built

- **Main form: the standalone desktop app above** (Electron) for Mac and Windows. As a free bonus, the same code also runs as a web page in Chrome or Edge.
- **Free building blocks, all allowed to be combined:**

  | Part | What it does | Licence |
  |---|---|---|
  | Saxi | Talks to the plotter, plans motion, base UI | AGPL-3.0 |
  | Plotterfun | Photo → line-art styles | MIT |
  | hersheytext | 19 single-line fonts | MIT (fonts: SIL OFL / Hershey) |
  | imagetracerjs | Trace logos into shapes | Public domain |
  | Clipper2 | Shape maths for hatching and concentric fills | Boost (free) |

- **Licence rule:** if you keep the app for yourself, there's nothing to do. If you share or sell it, you must publish its source code (Saxi's AGPL rule).

## Build order

Each step ends with a real plot on your AxiDraw.

1. **Foundation, as a real standalone app from day one.** Fork Saxi and put it inside the app shell. Make the Mac and Windows installers and the Plotter check screen. Install on **both** computers, check the firmware, and plot a test file from each. This proves the "no extra installs" promise before any new features are added.
2. **Page editor + paper sizes + Frame button.**
3. **Photo styles.** Bring in Plotterfun. Most of the code is already written; it mainly needs connecting.
4. **Single-line text.**
5. **Hatch fill + logo trace.**
6. **Extras.** Pen presets, colour pauses, resume, save projects.
7. **Final polish.** App icon, first-run welcome guide, Windows driver install button, firmware updater, and final installers.

## Decisions (2026-10-18)
- **Computers:** both Windows and Mac. Test both builds.
- **Highlight the print area:** both the pen-up Frame on paper *and* the live on-screen highlight while plotting.
- **Sharing:** private GitHub repo for now. No licence obligations unless it's shared later.
- **First version includes all the extras:** pen colours + swap pause, pen presets + test buttons, resume after a stop, save projects + SVG export + simple shapes. Extras 6, 7 and 9 are small or already in Saxi, so they come along too.
- **Name: PenPilot.** The repo and folder are `PenPilot`. The name stays "PenPilot" with no "AxiDraw" in it, which keeps it clear of Evil Mad Scientist's brand.
