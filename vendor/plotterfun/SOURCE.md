# Plotterfun (vendored, unchanged)

Photo → pen-line styles from [mitxela/plotterfun](https://github.com/mitxela/plotterfun)
at commit `faf67d4dadc359a9d5703b0c4e501ea3bbad84d9` (2025-08-06), MIT licence (`LICENSE`).
Some styles credit other authors in Plotterfun's menu: Halftone (HomineLudens), Boxes
(MarkJB), Dots and Jaggy (Tim Koop), Linescan, Woven and Peano (J-Waal), Margins (labusaid).

`external/` holds the two libraries some styles load:
- `stackblur.min.js`: [StackBlur](https://github.com/flozz/StackBlur), MIT.
- `rhill-voronoi-core.min.js`: [Javascript-Voronoi](https://github.com/gorhill/Javascript-Voronoi) by Raymond Hill, MIT.

PenPilot doesn't edit these files. The build copies them to `<ui>/plotterfun/`, and
`src/penpilot/photo.ts` runs each style as a Web Worker, the same way Plotterfun's own page does:
1. Start the worker.
2. The worker sends `['sliders', controls]`.
3. PenPilot sends `[config, imageData]`.
4. The worker replies with `['svg-path', d]` (once or several times) and `['msg', text]` progress.
