// Publishes a PenPilot release: the installers, the source code
// of that version (Saxi's AGPL licence asks for it next to public downloads)
// and latest.json, which PenPilot reads to offer the update
// (desktop/app/updater.cjs). Goes to the PUBLIC repo Ava-AgentOne/penpilot-releases;
// the working repo stays private, but gets the same release page too (with the
// installers), as a record.
//
// Before running: the version in desktop/app/package.json is set, committed and
// tagged vX.Y.Z; the Mac files are built (npm run dist:mac) and the Windows
// files are in release/windows/ (from the GitHub Actions build of that tag).
//
//   node desktop/scripts/publish-release.mjs 1.0.0 path/to/notes.md
//   node desktop/scripts/publish-release.mjs 1.0.0 path/to/notes.md --notes-only
//
// notes.md: a short "what's new" list; its "- " lines become the notes in the
// update message and the "What's new" list on the release page. --notes-only
// just rewrites an existing release's page from the notes.

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const REPO = "Ava-AgentOne/penpilot-releases";
const CODE_REPO = "Ava-AgentOne/PenPilot"; // private
const root = path.resolve(import.meta.dirname, "..", "..");
const [version, notesFile, flag] = process.argv.slice(2);
if (!version || !notesFile) {
  console.error("Usage: node desktop/scripts/publish-release.mjs <version> <notes.md>");
  process.exit(1);
}
const appVersion = JSON.parse(fs.readFileSync(path.join(root, "desktop/app/package.json"), "utf8")).version;
if (appVersion !== version) throw new Error(`desktop/app/package.json says ${appVersion}, not ${version}`);

const tag = `v${version}`;

// The release page: what's new (the notes), then how to get it.
const notesText = fs.readFileSync(notesFile, "utf8");
const intro = notesText
  .split("\n")
  .filter((l) => l.trim() && !l.startsWith("- "))
  .join("\n");
const changes = notesText.split("\n").filter((l) => l.startsWith("- "));
const body = [
  intro,
  "",
  `## What's new in ${version}`,
  "",
  ...changes,
  "",
  "## Get it",
  "",
  `- **Mac** (Apple Silicon): \`PenPilot-${version}-mac-arm64.dmg\`, then drag PenPilot into Applications.`,
  `- **Windows 10 / 11**: \`PenPilot-Setup-${version}.exe\` (or \`PenPilot-Portable-${version}.exe\` without installing).`,
  "- **Already have PenPilot?** It offers this update by itself (or use **Help → Check for updates…**).",
  "",
  `The source code of this version is in \`PenPilot-${version}-source.zip\` (AGPL-3.0).`,
  "",
].join("\n");
const bodyPath = path.join(root, "release/release-notes.md");
fs.mkdirSync(path.dirname(bodyPath), { recursive: true });
fs.writeFileSync(bodyPath, body);
// The code repo's copy links to the public downloads.
const codeBodyPath = path.join(root, "release/release-notes-code.md");
fs.writeFileSync(
  codeBodyPath,
  `${body}\n---\n\nPublic downloads (and the update file the app reads): https://github.com/${REPO}/releases/tag/${tag}\n`,
);
if (flag === "--notes-only") {
  execFileSync("gh", ["release", "edit", tag, "--repo", REPO, "--notes-file", bodyPath], { stdio: "inherit" });
  execFileSync("gh", ["release", "edit", tag, "--repo", CODE_REPO, "--notes-file", codeBodyPath], { stdio: "inherit" });
  console.log(`Updated the notes of ${tag} in both repos`);
  process.exit(0);
}
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
const notes = changes.map((l) => l.slice(2).trim());
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
    bodyPath,
    "--latest",
    ...Object.values(files),
    latestPath,
  ],
  { stdio: "inherit" },
);
console.log(`Published ${tag} to https://github.com/${REPO}/releases/tag/${tag}`);

// The same release in the private code repo, as a record (installers only; the tag is the source).
execFileSync(
  "gh",
  [
    "release",
    "create",
    tag,
    "--repo",
    CODE_REPO,
    "--verify-tag",
    "--title",
    `PenPilot ${version}`,
    "--notes-file",
    codeBodyPath,
    "--latest",
    files.macDmg,
    files.win,
    files.winPortable,
  ],
  { stdio: "inherit" },
);
console.log(`Recorded ${tag} in ${CODE_REPO}`);
