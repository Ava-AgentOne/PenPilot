# PenPilot: credits and licences

PenPilot is free software under the **GNU Affero General Public License v3.0**
(see `LICENSE`). It is built on these projects:

| Part | Author | Licence |
|---|---|---|
| [saxi](https://github.com/alexrudd2/saxi): plotter control, motion planning, base UI | Jeremy Rose (nornagon), Alex Rudd and contributors | AGPL-3.0 |
| [optimize-paths](https://www.npmjs.com/package/optimize-paths): line ordering | Jeremy Rose | AGPL-3.0 |
| [flatten-svg](https://www.npmjs.com/package/flatten-svg): reading SVG files | Jeremy Rose | ISC |
| [React](https://react.dev) | Meta Platforms, Inc. | MIT |
| [color-interpolate](https://www.npmjs.com/package/color-interpolate), [colormap](https://www.npmjs.com/package/colormap) | their authors | MIT |
| [Plotterfun](https://github.com/mitxela/plotterfun): photo → line-art styles | Tim Alex Jacobs (mitxela) and contributors | MIT |
| [skeleton-tracing](https://github.com/LingDong-/skeleton-tracing): centre-line tracing | Lingdong Huang | MIT |
| [imagetracerjs](https://github.com/jankovicsandras/imagetracerjs): outline tracing | András Jankovics | Public domain (Unlicense) |
| [StackBlur](https://github.com/flozz/StackBlur), [Javascript-Voronoi](https://github.com/gorhill/Javascript-Voronoi) (used by Plotterfun) | Fabien Loison, Mario Klingemann; Raymond Hill | MIT |
| Single-line fonts: Hershey Sans, Serif, Script and Gothic (9 fonts) | Dr. A. V. Hershey (U.S. National Bureau of Standards); data format by James Hurt, Cognition, Inc.; SVG conversion by Windell H. Oskay (Evil Mad Scientist) | Hershey Fonts licence (free use with this acknowledgement; full text in each font file) |
| Single-line fonts: EMS Readability, Allure, Felix, Elfin, Nixish, Osmotron and Tech (9 fonts) | Sheldon B. Michaels, from the original typeface designers named in each file; SVG by Windell H. Oskay | SIL Open Font License 1.1 |
| [hersheytext](https://github.com/techninja/hersheytextjs) (source of the font files above) | techninja | MIT |
| [Work Sans](https://fonts.google.com/specimen/Work+Sans) font (via @fontsource) | Wei Huang | SIL OFL 1.1 |
| [serialport](https://serialport.io) (macOS plotter connection) | Francis Gulotta and contributors | MIT |
| [Electron](https://www.electronjs.org) desktop runtime | OpenJS Foundation and contributors | MIT (Chromium's licences are listed in `LICENSES.chromium.html`) |

**Windows build only:** the EiBotBoard USB driver files and the official EBB firmware
updater, unchanged, from Evil Mad Scientist's [EggBot](https://github.com/evil-mad/EggBot)
repository (GPL-3.0). They ship as separate tools. See `windows-extras/SOURCE.md`.

AxiDraw is a trademark of Evil Mad Scientist Laboratories. PenPilot is an independent
project and is not made by or affiliated with them.
