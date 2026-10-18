# Single-stroke fonts (vendored, unchanged)

From [gitlab.com/oskay/svg-fonts](https://gitlab.com/oskay/svg-fonts) at commit
`8c71f2d9e1a5292047bb88e5595a766241b82cc6`, curated and prepared by Windell H. Oskay
(Evil Mad Scientist Laboratories / Bantam Tools). The upstream `README.md` is kept here.
It lists each EMS font's original typeface and designer.

- `EMS/`: 29 "EMS" single-stroke fonts derived from SIL Open Font License typefaces (`OFL.txt`).
- `Hershey/`: the Hershey fonts, plus Twin Sans (OFL, Keith Packard). The Hershey licence
  and the acknowledgement it requires are in each file's `<metadata>`.

Each glyph is a single-stroke path (`M`, `L`, `C`, `Z`), so a pen draws each letter once.
The build copies both folders into `<ui>/fonts-single-line/`, and `src/penpilot/text.ts`
reads them.
