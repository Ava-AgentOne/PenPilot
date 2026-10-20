// The Windows half of PenPilot's updates (desktop/app/updater.cjs).
//
// Once PenPilot closes, a small hidden PowerShell helper finishes the update:
//   - installed: runs the new installer silently, waits for it, then opens
//     PenPilot again (the installer's own "start afterwards" option doesn't
//     open it, so the helper does);
//   - portable: puts the new .exe where the old one was, removes the old one
//     and starts the new one.
// Each step is written to update.log next to the downloaded file.
//
// 1.0.0 and 1.0.1 used a cmd script that waited with `tasklist | find`. Started
// hidden, cmd has no console, `tasklist` prints nothing and `find` waits
// forever, so PenPilot closed and the update never ran. The helper only uses
// PowerShell's own process and file commands.
//
// How the helper is started matters too (tried on a Windows 10 VM, 2026-10-20):
//   - spawned "detached" (no console at all), Windows PowerShell 5.1 quits at
//     once without running anything;
//   - spawned normally, it's closed together with PenPilot (Node keeps its
//     children in a job that ends when PenPilot does).
// So a short-lived PowerShell, spawned normally, starts the helper with
// Start-Process: the helper gets its own hidden console and isn't in that job.
//
// No Electron here, so the scripts can be tried on their own.

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/** A PowerShell single-quoted string. */
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** One Windows command-line argument, quoted the way Windows programs read it. */
function winQuote(arg) {
  const s = String(arg);
  if (s && !/[\s"]/.test(s)) return s;
  return `"${s.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

/** PowerShell that starts a program (`exe`, `dir`: PowerShell expressions) with `args`. */
function startLine(exe, dir, args) {
  const line = `Start-Process -FilePath ${exe} -WorkingDirectory ${dir}`;
  return args.length ? `${line} -ArgumentList ${psQuote(args.map(winQuote).join(" "))}` : line;
}

/** The start of every helper: logging, and waiting for PenPilot (process `pid`) to close. */
function preamble(log, pid) {
  return [
    "$ErrorActionPreference = 'Continue'",
    `$log = ${psQuote(log)}`,
    "function Log($m) { Add-Content -LiteralPath $log -Value ((Get-Date -Format 'HH:mm:ss') + ' ' + $m) }",
    // Waits for a process; with a path, only if it's still that program (the number may be reused).
    "function Wait-Closed($id, $exe) {",
    "  $p = Get-Process -Id $id -ErrorAction SilentlyContinue",
    "  if ($p -and (-not $exe -or $p.Path -eq $exe)) { $p.WaitForExit() }",
    "}",
    `Log 'Waiting for PenPilot (process ${pid}) to close'`,
    `Wait-Closed ${pid} $null`,
    // PenPilot gave up waiting for this helper and said so (see waitForLog): do nothing.
    `if (Test-Path -LiteralPath ${psQuote(cancelFile(log))}) { Log 'Cancelled'; exit }`,
    "Log 'PenPilot closed'",
    // The reopened PenPilot is a normal one, as on the Mac (where "open" starts it afresh).
    "Remove-Item Env:\\PENPILOT_TEST_VERSION, Env:\\PENPILOT_UPDATE_FEED -ErrorAction SilentlyContinue",
  ];
}

const cancelFile = (log) => path.win32.join(path.win32.dirname(log), "update.cancel");

/**
 * The helper for an installed PenPilot: wait, run `setup` silently, reopen `exe`.
 * The installer also closes any PenPilot part still running from its folder.
 */
function setupScript({ pid, setup, exe, args = [], log }) {
  return [
    ...preamble(log, pid),
    `$s = Start-Process -FilePath ${psQuote(setup)} -ArgumentList '--updated','/S' -PassThru`,
    "$null = $s.Handle", // keeps the exit code readable after it ends
    "$s.WaitForExit()",
    "Log ('Installer finished, exit code ' + $s.ExitCode)",
    startLine(psQuote(exe), psQuote(path.win32.dirname(exe)), args),
    "Log 'Opened PenPilot'",
  ].join("\r\n");
}

/**
 * The helper for the portable .exe: wait for PenPilot and its launcher (the
 * portable .exe itself, `launcherPid`), put `downloaded` at `fresh`, start it,
 * then remove `old` (when it's a different file).
 */
function portableScript({ pid, launcherPid, downloaded, old, fresh, args = [], log }) {
  const replace = path.win32.resolve(fresh).toLowerCase() !== path.win32.resolve(old).toLowerCase();
  return [
    ...preamble(log, pid),
    // The launcher unpacks PenPilot each time and tidies up after it closes; the old .exe is in use until then.
    launcherPid ? `Wait-Closed ${launcherPid} ${psQuote(old)}` : "",
    `$run = ${psQuote(fresh)}`,
    "try {",
    `  Copy-Item -LiteralPath ${psQuote(downloaded)} -Destination $run -Force -ErrorAction Stop`,
    "  Log ('Copied the new version to ' + $run)",
    "} catch {",
    // A folder PenPilot can't write to: run the new version from the download instead, keep the old one.
    `  $run = ${psQuote(downloaded)}`,
    "  Log ('Could not copy the new version (' + $_ + '), running it from ' + $run)",
    "}",
    startLine("$run", "(Split-Path $run)", args),
    "Log 'Opened PenPilot'",
    replace
      ? [
          `if ($run -eq ${psQuote(fresh)}) {`,
          "  for ($i = 0; $i -lt 120; $i++) {",
          `    try { Remove-Item -LiteralPath ${psQuote(old)} -Force -ErrorAction Stop; Log 'Removed the old version'; break }`,
          "    catch { Start-Sleep -Milliseconds 500 }",
          "  }",
          "}",
        ].join("\r\n")
      : "",
  ]
    .filter(Boolean)
    .join("\r\n");
}

/** Where Windows keeps its own PowerShell (not whatever "powershell" is first on the PATH). */
function powershellPath() {
  return path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

const encode = (script) => Buffer.from(script, "utf16le").toString("base64");
const PS_OPTIONS = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden"];

/**
 * The program and arguments that start `script` as a hidden helper running
 * from `dir` (never PenPilot's own folder, which the installer replaces).
 * Scripts are passed encoded, so Windows' script-running policy doesn't apply.
 */
function helperCommand(script, dir) {
  const ps = powershellPath();
  const helperArgs = [...PS_OPTIONS, "-EncodedCommand", encode(script)].join(" ");
  const starter = `Start-Process -FilePath ${psQuote(ps)} -WindowStyle Hidden -WorkingDirectory ${psQuote(dir)} -ArgumentList ${psQuote(helperArgs)}`;
  return [ps, [...PS_OPTIONS, "-EncodedCommand", encode(starter)]];
}

/** Start `script` as a hidden helper that keeps running after PenPilot closes. */
function startHelper(script, dir) {
  const [ps, args] = helperCommand(script, dir);
  // Not detached (see the top of this file); the starter ends as soon as the helper is running.
  const child = spawn(ps, args, { cwd: dir, stdio: "ignore", windowsHide: true });
  child.on("error", () => {}); // reported by waitForLog below
  child.unref();
}

/**
 * Resolves once `log` has a line (the helper is running). After `ms` without
 * one, tells a late helper to do nothing and rejects, so PenPilot stays open.
 */
async function waitForLog(log, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (fs.statSync(log).size > 0) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  fs.writeFileSync(cancelFile(log), "");
  throw new Error("PenPilot couldn't start its installer helper. Download the new version from the releases page instead.");
}

module.exports = { setupScript, portableScript, helperCommand, startHelper, waitForLog, cancelFile, psQuote, winQuote };
