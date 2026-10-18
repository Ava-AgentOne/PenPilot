# PenPilot

A standalone desktop app for the **AxiDraw V3** pen plotter on **Mac and Windows**.
You install one thing and it works: no Inkscape, Node.js, Python or drivers to set up.

PenPilot is built on [saxi](https://github.com/alexrudd2/saxi) (AGPL-3.0), which
handles the plotter, motion planning, preview and plotting. Saxi's own README is
kept in [`docs/saxi-README.md`](docs/saxi-README.md). The full plan for PenPilot
is in [`PLAN.md`](PLAN.md).



## What works now (build steps 1–4)

**Single-line text (step 4):**
- **Add text** in **41 single-stroke fonts** (Windell Oskay's Hershey and EMS collection, 22 of them handwriting and script): each letter is one pen stroke, with no hollow outlines.
- **Arabic** (Alkalami, Noto Naskh, Amiri, Lateef, Reem Kufi, Tajawal) and **more handwriting** (Caveat, Dancing Script, Kalam, Homemade Apple, Indie Flower), written as **traced fonts**. PenPilot draws the text in the font, so Arabic joins and runs right-to-left correctly, then traces one pen line through each letter. Letter dots become small pen circles.
- Several lines, **letter size** (capital height in mm, measured from each font's real letters), **letter spacing**, **line spacing**, **left / centre / right**. Move, resize and turn it like any drawing; resizing changes the letter size.
- Letters a font can't write (e.g. Arabic) are named in a plain message.

**Tracing and photos (step 3):**
- Add an **image** (JPG, PNG, WebP, GIF) and it is **traced** into vector lines. **Trace: centre lines** is the default: one pen stroke down the middle of every line of a drawing, drawn in a single pass. **Trace: outlines** traces the edges of every dark shape, like a typical "image trace", so the pen draws both sides of each line. Sliders: Threshold, Inverted, Blur, Remove specks, Simplify, Smoothing, Detail.
- An **SVG made only of filled shapes** (typical image-trace output) gets a warning that the pen would draw every line twice, plus a **Trace centre lines instead** button. It converts the drawing in place, at the same size and position.
- Or turn a **photo** into pen-line art with one of **23 styles** from [Plotterfun](https://github.com/mitxela/plotterfun). Styles include Squiggle, Spiral (one continuous line), Stipples, Linedraw, Halftone, Waves, Peano and Mosaic.
- Each style's own sliders, plus **Detail**, **Brightness**, **Contrast** and **Inverted**. It redraws a moment after you stop moving a slider, and shows its progress.
- The photo shows faintly behind its lines while selected. Move, resize, turn and Frame work as for any drawing.

**Page editor (step 2):**
- **Several drawings on one page.** Add SVGs with **Add drawing…** or drag them in (several at once).
- **Move** by dragging and **resize** with the corner dot (proportions kept). Also: exact x / y / width / height in mm, **Turn 90°**, **Centre**, **Fit page**, arrow keys to nudge (Shift = 10 mm), Delete to remove. Drawings snap to the centre of the page.
- **Portrait / Landscape** switch. When the page doesn't fit the V3 as shown (A4 portrait is 297 mm tall, the V3 reaches 218 mm), PenPilot turns the plot and tells you to put the sheet in sideways, top of the page on the left.
- **Reach warning:** paper bigger than 300 × 218 mm gets a striped "can't reach" area. Drawings sticking into it, or off the sheet, are flagged and cropped.
- **Frame:** with the pen lifted, the plotter traces the rectangle the drawings cover, once or round and round until you press Stop frame.
- **While plotting,** lines already drawn turn teal on screen and a red cross follows the pen.
- **Save your own paper sizes** (Custom → name → Save size). They appear as ★ in the paper list.
- Each drawing is a layer, so you can choose which drawings to plot.

**Foundation (step 1):**

- **One install** on Mac (`.dmg`) or Windows (installer, or a portable `.exe` that runs without installing).
- **Plotter check** when the app opens, and again whenever the plotter is plugged in or unplugged. In plain words it tells you if:
  - the plotter isn't found (cable, port, a charge-only cable);
  - Windows sees the plotter but has no driver (Windows 8 and older). An **Install driver** button fixes this;
  - the plotter doesn't answer (another program has it open);
  - the firmware is older than 2.5.3. On Windows, **Update firmware** opens the official updater (firmware 3.1.7);
  - the motor power adapter isn't plugged in.
- **Reverse pen direction** tick-box for pen-lift motors that move the other way (common on AxiDraw-compatible clones). Pause, cancel and the pen lift before the first move all respect it.
- A clear message when a file can't be plotted (a photo, an SVG with no lines), instead of hanging on "Loading file...".
- Everything saxi already does: drop in an SVG, choose paper (A4 landscape by default) and margins, preview with time estimate, pen up/down heights, plot, pause, resume and cancel.

## Installing

### Mac (Apple Silicon)

1. Open `PenPilot-<version>-mac-arm64.dmg` and drag **PenPilot** into **Applications**.
2. **First open only:** PenPilot isn't signed with a paid Apple certificate, so macOS blocks it the first time it comes from a download or another computer:
   - Double-click PenPilot. When macOS says it can't check it, press **Done**.
   - Open **System Settings → Privacy & Security**, scroll down, and press **Open Anyway** next to "PenPilot was blocked". Enter your password.
   - After that it opens normally. If you built it on this Mac yourself, you won't see the warning at all.

### Windows 10 / 11

1. Run `PenPilot-Setup-<version>.exe`, or use `PenPilot-Portable-<version>.exe` from anywhere without installing.
2. **First run only:** Windows SmartScreen may say "Windows protected your PC". Press **More info → Run anyway**. This appears because the app isn't signed with a paid certificate.
3. No driver is needed on Windows 10/11. On Windows 8 or older, PenPilot offers **Install driver** on the Plotter check screen. Windows asks for permission once.

## Building

```bash
npm ci
npm run desktop     # run the app from source
npm run dist:mac    # Mac installer → release/PenPilot-<version>-mac-arm64.dmg
```

The **Windows** installer and portable `.exe` are built on GitHub's Windows machines:

```bash
gh workflow run desktop.yml
gh run download --name PenPilot-windows --dir release/windows
```

Pushing a tag like `v0.1.0` builds them too.

### How it fits together

| Folder | What's in it |
|---|---|
| `src/` | saxi's UI, plotter driver and motion planner. PenPilot additions are in `src/penpilot/`. |
| `desktop/app/` | The desktop shell (Electron): window, private `app://` page loader, automatic plotter selection, Windows helpers. `desktop/app/ui/` is generated by `npm run desktop:ui`. |
| `desktop/windows-extras/` | Official EiBotBoard USB driver and firmware updater (Windows build only). See its `SOURCE.md`. |
| `electron-builder.yml` | Installer settings for both systems. |
| `samples/penpilot-test.svg` | A small test drawing (about 45 seconds). |

How PenPilot reaches the plotter (only ever the AxiDraw's board, USB `04D8:FD92`,
matched in `desktop/app/serial-match.cjs`):

- **macOS: direct USB serial** from the desktop shell (`desktop/app/native-serial.cjs`,
  Node `serialport` with its prebuilt N-API driver), streamed to the UI over IPC
  (`src/penpilot/native-port.ts`). Chromium's Web Serial isn't used on the Mac:
  - The EiBotBoard reports no USB serial number, so Chromium never pre-approves it.
  - Its port picker (and even its plug/unplug events) start macOS's Bluetooth stack on
    the main thread. That froze the app until a Bluetooth permission prompt was
    answered, once for every new build.
- **Windows: Web Serial** inside Electron, with the board pre-approved by its Windows
  device ID, so nothing appears on screen.

## Licence

AGPL-3.0, the same as saxi. See [`LICENSE`](LICENSE) and [`NOTICE.md`](NOTICE.md) for all the
parts PenPilot is built from. AxiDraw is a trademark of Evil Mad Scientist Laboratories.
PenPilot isn't made by or affiliated with them.
