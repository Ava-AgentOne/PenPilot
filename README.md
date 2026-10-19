<p align="center">
  <img src="desktop/build/icon-win-256.png" width="128" height="128" alt="PenPilot icon: a plotter's pen carriage drawing a line">
</p>

<h1 align="center">PenPilot</h1>

<p align="center">
  A standalone app for the <strong>AxiDraw V3</strong> pen plotter, on Mac and Windows.<br>
  Put drawings, photos and text on a page, turn them into pen lines, and plot them. Nothing else to install.
</p>

<p align="center">
  <a href="https://github.com/Ava-AgentOne/penpilot-releases/releases/latest"><strong>Download the latest version</strong></a>
</p>

## Top features

- **Drawings and photos into pen lines.** Trace line art into single pen strokes, or turn a photo into line art with 23 styles. SVG files work too.
- **Handwriting and Arabic text.** 41 single-stroke fonts plus Arabic and handwriting fonts, written with one pen line per letter or as filled letters.
- **Hatch fill.** Solid-looking shapes and letters with lines, cross-hatch or concentric fills. Holes stay empty.
- **Shapes.** Rectangles, circles and page borders, for cards and certificates.
- **Page layout.** Several drawings on one page, any paper size, portrait or landscape. Move, resize, turn and duplicate, with undo, redo and zoom.
- **Several pens.** Give each drawing a pen, each with its own heights and speed. PenPilot stops and asks for the next pen.
- **Frame, then plot.** Trace the drawing area with the pen lifted to line up the paper, and watch the plot's progress. Pause, stop, and continue from any line.
- **Choose what to plot.** Tick drawings on and off, for example to add text to a page you've already plotted.
- **Projects.** Save and reopen your page (double-click a `.penpilot` file), or export it as SVG.
- **Plotter check.** Tells you in plain words what's wrong if the plotter isn't ready. On Windows it includes the driver and the firmware updater.
- **Automatic updates.** PenPilot tells you when a new version is ready and installs it for you.

## Install

Download from the [releases page](https://github.com/Ava-AgentOne/penpilot-releases/releases/latest).

**Mac (Apple Silicon, M1 or newer):** open `PenPilot-…-mac-arm64.dmg` and drag **PenPilot** into
**Applications**. The first time, macOS says it can't check the app (it isn't signed with a
paid Apple certificate): open **System Settings → Privacy & Security** and press
**Open Anyway**. You only do this once.

**Windows 10 / 11:** run `PenPilot-Setup-….exe`, or use `PenPilot-Portable-….exe` without
installing. If Windows says "Windows protected your PC", press **More info → Run anyway**
(only once). No driver is needed on Windows 10 and 11; on older Windows the Plotter check
offers **Install driver**.

## Updates

PenPilot checks for a new version when it opens and every few hours. When one is ready it
shows what's new and offers **Update now**: it downloads the update, checks it, installs it and
opens again. **Help → Check for updates…** checks straight away. On a Mac, keep PenPilot in
**Applications** so it can update itself.

## For developers

```bash
npm ci
npm run desktop     # run the app from source
npm run dist:mac    # Mac installer and update zip → release/
```

The Windows installer and portable `.exe` are built by GitHub Actions
(`.github/workflows/desktop.yml`), by hand or when a `v*` tag is pushed.

**Releasing a version:** set the version in `desktop/app/package.json`, write
`docs/release-notes/<version>.md` (its `- ` lines are the changes shown in the app and on the
release), commit, push the tag `v<version>`, run `npm run dist:mac`, download the Windows build
into `release/windows/`, then run
`node desktop/scripts/publish-release.mjs <version> docs/release-notes/<version>.md`.
It publishes the installers, the source code of that version and `latest.json` (which the app
reads for updates) to [penpilot-releases](https://github.com/Ava-AgentOne/penpilot-releases).

| Folder | What's in it |
|---|---|
| `src/` | saxi's plotter driver and motion planner, and the app's screens. PenPilot's own parts are in `src/penpilot/`. |
| `desktop/app/` | The desktop app (Electron): window, menus, plotter connection, project files, updates. |
| `desktop/build/` | App icons (made by `desktop/scripts/make-icons.cjs`). |
| `desktop/windows-extras/` | The official EiBotBoard USB driver and firmware updater (Windows only). |
| `vendor/` | Plotterfun's photo styles and the single-stroke fonts. |

On the Mac, PenPilot talks to the plotter directly over USB serial (`desktop/app/native-serial.cjs`);
on Windows it uses Web Serial. Either way it only ever opens the AxiDraw's own board (USB `04D8:FD92`).

## Licence

Based on [saxi](https://github.com/alexrudd2/saxi) by Jeremy Rose and contributors, and
licensed under the **AGPL-3.0**, the same as saxi. See [`LICENSE`](LICENSE) and
[`NOTICE.md`](NOTICE.md) for all the parts PenPilot is built from. AxiDraw is a trademark of
Evil Mad Scientist Laboratories; PenPilot isn't made by or affiliated with them.
