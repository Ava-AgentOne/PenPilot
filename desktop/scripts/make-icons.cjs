// Makes PenPilot's app icons (desktop/build/icon.icns, icon.ico, icon.png)
// from the design below: a plotter's pen carriage, in white lines on purple,
// drawing a teal line ("F", chosen 2026-10-18).
//
// Run with Electron (it renders the SVG at every size, crisp):
//   npx electron desktop/scripts/make-icons.cjs
// Needs macOS for the .icns (iconutil).

const { app, BrowserWindow } = require("electron");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const OUT = path.join(__dirname, "..", "build");

// The design, on a 160 x 160 tile. `bold`: thicker lines and fewer details for tiny sizes.
function tile(bold) {
  const w = bold ? 7 : 3.5;
  const clamp = bold ? "" : `
    <rect x="93" y="62" width="18" height="7" rx="1.5" fill="#604987" stroke="#fff" stroke-width="3"/>
    <rect x="93" y="80" width="18" height="7" rx="1.5" fill="#604987" stroke="#fff" stroke-width="3"/>`;
  return `
  <rect x="0" y="0" width="160" height="160" rx="36" fill="#604987"/>
  <path d="M102 124 C90 108 76 140 62 124 S36 110 26 126" fill="none" stroke="#75D5CD" stroke-width="${bold ? 9 : 5}" stroke-linecap="round"/>
  <rect x="8" y="36" width="80" height="12" rx="2" fill="#604987" stroke="#fff" stroke-width="${w}"/>
  <rect x="84" y="28" width="34" height="44" rx="4" fill="#604987" stroke="#fff" stroke-width="${w}"/>
  <rect x="90" y="17" width="22" height="11" rx="2" fill="#604987" stroke="#fff" stroke-width="${w}"/>
  <rect x="97" y="50" width="10" height="60" rx="3" fill="#604987" stroke="#fff" stroke-width="${w}"/>
  <polygon points="97,110 107,110 102,122" fill="#DE7272" stroke="#DE7272" stroke-width="${bold ? 4 : 2}" stroke-linejoin="round"/>${clamp}`;
}

// Mac icons sit inside Apple's grid: the tile is 824 of 1024 px, centred.
// Windows icons fill the square.
function svg(size, kind) {
  const bold = size <= 32;
  const pad = kind === "mac" ? (160 * 1024) / 824 / 2 - 80 : 0;
  const box = 160 + 2 * pad;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${-pad} ${-pad} ${box} ${box}">${tile(bold)}</svg>`;
}

// Draw the SVG onto a canvas of exactly `size` pixels (sharp, transparent corners).
async function render(win, size, kind) {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg(size, kind))}`;
  const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = ${size};
      c.getContext("2d").drawImage(img, 0, 0, ${size}, ${size});
      resolve(c.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("render failed"));
    img.src = ${JSON.stringify(url)};
  })`);
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

// A .ico holding PNG images (Windows Vista and later read these).
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach(({ size, data }, i) => {
    const e = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, e);
    dir.writeUInt8(size >= 256 ? 0 : size, e + 1);
    dir.writeUInt16LE(1, e + 4); // colour planes
    dir.writeUInt16LE(32, e + 6); // bits per pixel
    dir.writeUInt32LE(data.length, e + 8);
    dir.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL("data:text/html,<html><body></body></html>");
  fs.mkdirSync(OUT, { recursive: true });

  // macOS: an .iconset, then iconutil.
  const set = fs.mkdtempSync(path.join(os.tmpdir(), "penpilot-icon-")) + "/icon.iconset";
  fs.mkdirSync(set);
  for (const base of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(set, `icon_${base}x${base}.png`), await render(win, base, "mac"));
    fs.writeFileSync(path.join(set, `icon_${base}x${base}@2x.png`), await render(win, base * 2, "mac"));
  }
  execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(OUT, "icon.icns")]);
  fs.writeFileSync(path.join(OUT, "icon.png"), await render(win, 1024, "mac"));

  // Windows.
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const size of sizes) pngs.push({ size, data: await render(win, size, "win") });
  fs.writeFileSync(path.join(OUT, "icon.ico"), ico(pngs));
  fs.writeFileSync(path.join(OUT, "icon-win-256.png"), pngs[pngs.length - 1].data);

  console.log("icons written to", OUT);
  app.quit();
});
