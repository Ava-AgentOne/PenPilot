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
| Single-stroke fonts: Hershey Sans, Serif, Script and Gothic (11 fonts), from [gitlab.com/oskay/svg-fonts](https://gitlab.com/oskay/svg-fonts) | Dr. A. V. Hershey (U.S. National Bureau of Standards); data format by James Hurt, Cognition, Inc.; SVG conversion by Windell H. Oskay (Evil Mad Scientist) | Hershey Fonts licence (free use with this acknowledgement; full text in each font file) |
| Single-stroke fonts: 29 "EMS" fonts (e.g. Casual Hand, Neato, Pepita, Society, Invite, Readability) and Twin Sans | Windell H. Oskay / Sheldon B. Michaels, from the OFL typefaces and designers listed in `vendor/single-line-fonts/README.md`; Twin Sans by Keith Packard | SIL Open Font License 1.1 |
| Fonts drawn and traced for text: Alkalami, Amiri, Noto Naskh Arabic, Lateef, Reem Kufi, Tajawal, Caveat, Dancing Script, Kalam, Indie Flower (via @fontsource) | their designers (see each font on fonts.google.com) | SIL Open Font License 1.1 |
| Homemade Apple font (via @fontsource) | Font Diner | Apache 2.0 |
| [Work Sans](https://fonts.google.com/specimen/Work+Sans) font (via @fontsource) | Wei Huang | SIL OFL 1.1 |
| [Clipper](https://sourceforge.net/projects/polyclipping/) via [clipper-lib](https://www.npmjs.com/package/clipper-lib): shrinking outlines for concentric fill | Angus Johnson; JavaScript port by Timo (jsclipper) | Boost Software License 1.0 |
| [serialport](https://serialport.io) (macOS plotter connection) | Francis Gulotta and contributors | MIT |
| [Electron](https://www.electronjs.org) desktop runtime | OpenJS Foundation and contributors | MIT (Chromium's licences are listed in `LICENSES.chromium.html`) |

**Windows build only:** the EiBotBoard USB driver files and the official EBB firmware
updater, unchanged, from Evil Mad Scientist's [EggBot](https://github.com/evil-mad/EggBot)
repository (GPL-3.0). They ship as separate tools. See `windows-extras/SOURCE.md`.

AxiDraw is a trademark of Evil Mad Scientist Laboratories. PenPilot is an independent
project and is not made by or affiliated with them.
