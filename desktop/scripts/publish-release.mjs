// Publishes a PenPilot release: the installers, the source code
// of that version (Saxi's AGPL licence asks for it next to public downloads)
// and latest.json, which PenPilot reads to offer the update
// (desktop/app/updater.cjs). Goes to the PUBLIC repo Ava-AgentOne/penpilot-releases;
// the working repo stays private.
//
// Before running: the version in desktop/app/package.json is set, committed and
// tagged vX.Y.Z; the Mac files are built (npm run dist:mac) and the Windows
// files are in release/windows/ (from the GitHub Actions build of that tag).
//
//   node desktop/scripts/publish-release.mjs 1.0.0 path/to/notes.md
//
// notes.md: a short "what's new" list; its "- " lines become the notes in the
// update message.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REPO = "Ava-AgentOne/penpilot-releases";
const root = path.resolve(import.meta.dirname, "..", "..");
const [version, notesFile] = process.argv.slice(2);
if (!version || !notesFile) {
  console.error("Usage: node desktop/scripts/publish-release.mjs <version> <notes.md>");
  process.exit(1);
}
const appVersion = JSON.parse(fs.readFileSync(path.join(root, "desktop/app/package.json"), "utf8")).version;
if (appVersion !== version) throw new Error(`desktop/app/package.json says ${appVersion}, not ${version}`);

const tag = `v${version}`;
const files = {
  mac: path.join(root, `release/PenPilot-${version}-mac-arm64.zip`),
  macDmg: path.join(root, `release/PenPilot-${version}-mac-arm64.dmg`),
  win: path.join(root, `release/windows/PenPilot-Setup-${version}.exe`),
  winPortable: path.join(root, `release/windows/PenPilot-Portable-${version}.exe`),
  source: path.join(root, `release/PenPilot-${version}-source.zip`),
};
// The source of exactly this version (the tag), as a zip.
execFileSync("git", ["-C", root, "archive", "--format=zip", `--prefix=PenPilot-${version}/`, "-o", files.source, tag]);
for (const f of Object.values(files)) if (!fs.existsSync(f)) throw new Error(`Missing ${f}`);

const base = `https://github.com/${REPO}/releases/download/${tag}/`;
const entry = (f) => ({
  url: base + encodeURIComponent(path.basename(f)),
  sha256: crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex"),
  size: fs.statSync(f).size,
});
const notes = fs
  .readFileSync(notesFile, "utf8")
  .split("\n")
  .filter((l) => l.startsWith("- "))
  .map((l) => l.slice(2).trim());
const latest = {
  version,
  date: new Date().toISOString().slice(0, 10),
  notes,
  mac: entry(files.mac),
  win: entry(files.win),
  winPortable: entry(files.winPortable),
  source: entry(files.source),
};
const latestPath = path.join(root, "release/latest.json");
fs.writeFileSync(latestPath, `${JSON.stringify(latest, null, 2)}\n`);

execFileSync(
  "gh",
  [
    "release",
    "create",
    tag,
    "--repo",
    REPO,
    "--title",
    `PenPilot ${version}`,
    "--notes-file",
    notesFile,
    "--latest",
    ...Object.values(files),
    latestPath,
  ],
  { stdio: "inherit" },
);
console.log(`Published ${tag} to https://github.com/${REPO}/releases/tag/${tag}`);
