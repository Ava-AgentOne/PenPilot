// PenPilot's updates.
//
// PenPilot checks a small "latest.json" in the public releases repo (only
// installers and source zips live there; the working repo stays private).
// When it lists a newer version, the UI shows "PenPilot X is ready". Update
// now downloads the file for this computer, checks its SHA-256, and installs:
//   - Mac: unzips the new PenPilot.app, then a small script waits for this
//     PenPilot to close, swaps the app in place and opens it again. (Apple's
//     own updater needs a paid signature, so it isn't used.)
//   - Windows (installed): runs the new installer silently once PenPilot has
//     closed; it reopens PenPilot when done.
//   - Windows (portable .exe): puts the new .exe next to the old one, removes
//     the old one, and starts the new one.

const { app, BrowserWindow, net, shell } = require("electron");
const { execFile, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { handle } = require("./ipc-guard.cjs");

const RELEASES = "https://github.com/Ava-AgentOne/penpilot-releases/releases";
const FEED = `${RELEASES}/latest/download/latest.json`;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

// For testing only: another feed (its files must come from the same place),
// and pretending to be an older version.
const feedUrl = process.env.PENPILOT_UPDATE_FEED || FEED;
const allowedPrefix = process.env.PENPILOT_UPDATE_FEED
  ? new URL(".", process.env.PENPILOT_UPDATE_FEED).href
  : `${RELEASES}/download/`;
const currentVersion = () => process.env.PENPILOT_TEST_VERSION || app.getVersion();

/** -1, 0 or 1: how version a compares with version b ("1.2.3"). */
function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b).split(/[.-]/).map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  }
  return 0;
}

/** Which download this copy of PenPilot needs: "mac", "win" or "winPortable". */
function platformKey() {
  if (process.platform === "darwin") return "mac";
  if (process.platform === "win32") return process.env.PORTABLE_EXECUTABLE_FILE ? "winPortable" : "win";
  return null;
}

/** The .app bundle this PenPilot runs from (macOS). */
function macBundle() {
  return path.resolve(app.getPath("exe"), "..", "..", "..");
}

/** Why this copy can't replace itself, or null if it can. */
function cannotInstallReason() {
  const key = platformKey();
  if (!key) return "Updates aren't available on this system.";
  if (!app.isPackaged) return "This is a development copy of PenPilot.";
  if (key === "mac") {
    const bundle = macBundle();
    try {
      fs.accessSync(path.dirname(bundle), fs.constants.W_OK);
    } catch {
      return "PenPilot can only update itself when it's in your Applications folder. Drag it into Applications, then open it from there.";
    }
    if (!bundle.endsWith(".app") || bundle.includes("/AppTranslocation/")) {
      return "PenPilot can only update itself when it's in your Applications folder. Drag it into Applications, then open it from there.";
    }
  }
  return null;
}

let latest = null; // the newest release seen, if newer than this copy
let waitingToInstall = false; // downloaded; installs as soon as PenPilot closes

/** Fetch the feed. Returns what the UI needs, or throws with a plain message. */
async function check() {
  let res;
  try {
    res = await net.fetch(feedUrl, { cache: "no-store" });
  } catch {
    throw new Error("PenPilot couldn't reach the internet to check for updates.");
  }
  if (!res.ok) throw new Error(`PenPilot couldn't check for updates (the server said ${res.status}).`);
  const feed = await res.json();
  const key = platformKey();
  const file = key ? feed[key] : null;
  const newer = typeof feed.version === "string" && compareVersions(currentVersion(), feed.version) < 0;
  latest = newer && file ? feed : null;
  return {
    current: currentVersion(),
    version: feed.version,
    available: Boolean(latest),
    notes: Array.isArray(feed.notes) ? feed.notes.map(String) : [],
    cannotInstall: latest ? cannotInstallReason() : null,
    page: `${RELEASES}/latest`,
  };
}

function sendToUi(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}

/** Download `file` ({url, sha256, size}) into dir, reporting progress; checks the SHA-256. */
async function download(file, dir) {
  if (typeof file.url !== "string" || !file.url.startsWith(allowedPrefix)) {
    throw new Error("The update file isn't from PenPilot's releases page, so it wasn't downloaded.");
  }
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, decodeURIComponent(new URL(file.url).pathname.split("/").pop()));
  const res = await net.fetch(file.url);
  if (!res.ok || !res.body) throw new Error(`The download failed (the server said ${res.status}).`);
  const total = Number(res.headers.get("content-length")) || file.size || 0;
  const hash = crypto.createHash("sha256");
  const out = fs.createWriteStream(target);
  const reader = res.body.getReader();
  let received = 0;
  let lastSent = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    hash.update(value);
    received += value.length;
    if (!out.write(Buffer.from(value))) await new Promise((r) => out.once("drain", r));
    const now = Date.now();
    if (now - lastSent > 150) {
      lastSent = now;
      sendToUi("penpilot:update-progress", { received, total });
    }
  }
  await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
  sendToUi("penpilot:update-progress", { received, total: total || received });
  if (hash.digest("hex") !== String(file.sha256).toLowerCase()) {
    fs.rmSync(target, { force: true });
    throw new Error("The downloaded update didn't match its check code, so it wasn't installed. Try again later.");
  }
  return target;
}

const run = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(String(stdout).trim()))),
  );

/** Arguments to reopen PenPilot with (as started, minus any project file). */
function relaunchArgs() {
  return process.argv.slice(1).filter((a) => !a.toLowerCase().endsWith(".penpilot"));
}

const shQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

async function installMac(zip, version) {
  const dir = path.join(path.dirname(zip), "unpacked");
  fs.rmSync(dir, { recursive: true, force: true });
  await run("/usr/bin/ditto", ["-x", "-k", zip, dir]);
  const newApp = path.join(dir, "PenPilot.app");
  const got = await run("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleShortVersionString",
    path.join(newApp, "Contents", "Info.plist"),
  ]);
  if (got !== version) throw new Error(`The update contained PenPilot ${got}, not ${version}, so it wasn't installed.`);
  const old = macBundle();
  const script = path.join(path.dirname(zip), "swap.sh");
  fs.writeFileSync(
    script,
    [
      "#!/bin/bash",
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
      `OLD=${shQuote(old)}; NEW=${shQuote(newApp)}`,
      'rm -rf "$OLD.old"',
      'if mv "$OLD" "$OLD.old" && /usr/bin/ditto "$NEW" "$OLD"; then rm -rf "$OLD.old"; else rm -rf "$OLD"; mv "$OLD.old" "$OLD"; fi',
      'xattr -dr com.apple.quarantine "$OLD" 2>/dev/null',
      `open "$OLD" --args ${relaunchArgs().map(shQuote).join(" ")}`,
      "",
    ].join("\n"),
  );
  spawn("/bin/bash", [script], { detached: true, stdio: "ignore" }).unref();
}

function installWindows(file, portable) {
  const dir = path.dirname(file);
  const script = path.join(dir, "update.cmd");
  const wait = [
    "@echo off",
    ":wait",
    `tasklist /FI "PID eq ${process.pid}" 2>nul | find "${process.pid}" >nul`,
    "if not errorlevel 1 ( timeout /t 1 /nobreak >nul & goto wait )",
  ];
  if (portable) {
    const old = process.env.PORTABLE_EXECUTABLE_FILE;
    const fresh = path.join(path.dirname(old), path.basename(file));
    wait.push(`copy /Y "${file}" "${fresh}" >nul`);
    if (path.resolve(fresh) !== path.resolve(old)) wait.push(`del "${old}"`);
    wait.push(`start "" "${fresh}"`);
  } else {
    wait.push(`start "" "${file}" --updated /S --force-run`);
  }
  fs.writeFileSync(script, `${wait.join("\r\n")}\r\n`);
  spawn("cmd.exe", ["/c", script], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

/** Download and install the newest release, then close PenPilot so it can finish. */
async function install() {
  if (!latest) throw new Error("There's no update to install.");
  const reason = cannotInstallReason();
  if (reason) throw new Error(reason);
  const key = platformKey();
  const dir = path.join(app.getPath("temp"), `penpilot-update-${latest.version}`);
  const file = await download(latest[key], dir);
  if (key === "mac") await installMac(file, latest.version);
  else installWindows(file, key === "winPortable");
  waitingToInstall = true;
  sendToUi("penpilot:update-progress", { installing: true });
  // Closing asks first if the page has unsaved changes; the swap waits until PenPilot really closes.
  setTimeout(() => app.quit(), 600);
}

/** Check soon after opening, then every few hours; tell the UI when there's a new version. */
function setUpUpdates(ipcMain) {
  handle(ipcMain, "penpilot:update-check", async () => {
    try {
      return { ok: true, ...(await check()) };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  });
  handle(ipcMain, "penpilot:update-install", async () => {
    try {
      await install();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  });
  handle(ipcMain, "penpilot:update-page", () => shell.openExternal(`${RELEASES}/latest`));
  if (!app.isPackaged && !process.env.PENPILOT_UPDATE_FEED) return;
  const auto = async () => {
    try {
      const info = await check();
      if (info.available) sendToUi("penpilot:update-available", info);
    } catch {
      // Offline or the releases page is unreachable: try again next time.
    }
  };
  setTimeout(auto, 8000);
  setInterval(auto, CHECK_EVERY_MS);
}

/** An update is downloaded and waits for PenPilot to close (e.g. the user kept it open to save first). */
const updateWaiting = () => waitingToInstall;

module.exports = { setUpUpdates, compareVersions, updateWaiting };
