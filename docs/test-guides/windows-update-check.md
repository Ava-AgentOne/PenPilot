# PenPilot Windows Update Check

Thank you for testing PenPilot on this VM: your report found why Windows updates never
finished. Here's the fix, to try **before** it's released.

> **Test and report only.** Don't change PenPilot or push to any repo. Explain things to the owner in plain language.

## What changed

- **Bug 1 (stuck forever):** the cmd script that waited with `tasklist | find` is gone. A hidden
  **PowerShell helper** now waits for PenPilot to close using PowerShell's own process commands
  (`Get-Process` and `WaitForExit()`), which need no console.
- **Bug 2 (never reopened):** the helper runs the installer silently (`--updated /S`, no more
  `--force-run`), waits for it to finish, then **starts PenPilot itself**, with the same
  arguments it had.
- **Portable:** the helper waits for PenPilot **and** its portable launcher (which tidies up after
  PenPilot closes), copies the new .exe beside the old one, starts it, then removes the old one.
- PenPilot only closes once the helper has written its first log line, so a helper that can't
  start shows a message instead of PenPilot just disappearing.
- Each step goes to `update.log` next to the downloaded file.
- 1.0.0 and 1.0.1 won't be offered updates any more (their updater is the broken one). The feed
  lists Windows files under new names that only 1.0.2 and later read. Windows copies get 1.0.2
  by hand once.
- Small fixes from your notes: the sidebar scrollbar is thin and purple on Windows; Plotter check
  → Technical details now says which ports were refused (your COM1 was never used).

## Part 1: try the helper now (before 1.0.2 is released)

This uses the **exact helper code** from 1.0.2 (`windows-update.cjs` below), started the exact way
PenPilot starts it (same `spawn` options as your Bug 1 test).

1. Make a scratch folder, e.g. `C:\pp-helper` (not inside PenPilot's folders), and save the two
   files below into it. You'll also need `cdp.mjs` from the first test.
2. Have PenPilot **1.0.1 installed** (it is, from the first test) and its installer at
   `$env:TEMP\penpilot-update-1.0.1\PenPilot-Setup-1.0.1.exe` (left over from the first test;
   if it's gone, download it again and check its SHA-256:
   `030a15e6db6c3eb2907fa7e155bcc94e86c686f436d340dd41766510873a160c`).

`windows-update.cjs` (copied from PenPilot's source, unchanged):

```js
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
// PowerShell's own process and file commands, which need no console.
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

/**
 * Start `script` in a hidden PowerShell that keeps running after PenPilot closes.
 * It runs from `dir` (never PenPilot's own folder, which the installer replaces).
 * Passed encoded, so Windows' script-running policy doesn't apply.
 */
function startHelper(script, dir) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const child = spawn(
    powershellPath(),
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-EncodedCommand", encoded],
    { cwd: dir, detached: true, stdio: "ignore", windowsHide: true },
  );
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

module.exports = { setupScript, portableScript, startHelper, waitForLog, cancelFile, psQuote, winQuote };
```

`try-helper.mjs` (starts the helper the way PenPilot does, then exits like PenPilot would):

```js
// Starts PenPilot's Windows update helper on its own, exactly as PenPilot 1.0.2 does,
// then exits (as PenPilot would). Needs windows-update.cjs in the same folder.
//   node try-helper.mjs setup    <PenPilot pid> <setup .exe> <PenPilot.exe>
//   node try-helper.mjs portable <PenPilot pid> <launcher pid> <downloaded .exe> <old .exe> <new .exe>
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const w = require("./windows-update.cjs");
const [mode, ...a] = process.argv.slice(2);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "penpilot-helper-test-"));
const log = path.join(dir, "update.log");
const args = ["--remote-debugging-port=9333"]; // what the reopened PenPilot gets
const script =
  mode === "setup"
    ? w.setupScript({ pid: Number(a[0]), setup: a[1], exe: a[2], args, log })
    : w.portableScript({ pid: Number(a[0]), launcherPid: Number(a[1]), downloaded: a[2], old: a[3], fresh: a[4], args, log });
fs.writeFileSync(path.join(dir, "helper.ps1"), script); // a copy to read; the helper gets it encoded
w.startHelper(script, dir);
await w.waitForLog(log);
console.log(`Helper is running. Its log: ${log}\n${fs.readFileSync(log, "utf8")}`);
```

### Test A: installed PenPilot

Start PenPilot with the debug port, find its main process, and start the helper. It reinstalls
the same 1.0.1, which is fine for this test.

```powershell
cd C:\pp-helper
$exe = "$env:LOCALAPPDATA\Programs\PenPilot\PenPilot.exe"
$setup = "$env:TEMP\penpilot-update-1.0.1\PenPilot-Setup-1.0.1.exe"
Start-Process $exe -ArgumentList '--remote-debugging-port=9333'
Start-Sleep 10
$main = Get-CimInstance Win32_Process -Filter "Name='PenPilot.exe'" | Where-Object { $_.CommandLine -notmatch '--type=' } | Select-Object -First 1
node try-helper.mjs setup $main.ProcessId $setup $exe
```

Check, and report each:

1. It prints **"Helper is running"** and the log path, with one line: *Waiting for PenPilot (process N) to close*.
2. **It really waits:** after 15 seconds PenPilot is still open and the log still has just that line.
3. Close PenPilot the way a user would: `(Get-Process -Id $main.ProcessId).CloseMainWindow()`.
4. Within about 2 minutes the log shows *PenPilot closed*, *Installer finished, exit code 0* and
   *Opened PenPilot*, and **PenPilot is open again by itself**. `node cdp.mjs eval "(async () => (await window.penpilot.info()))()"`
   answers (which also proves it reopened with its arguments).
5. Note the times between the log lines, whether the reopened window came to the front, and
   whether **any window flashed** (a console, an installer) at any point.

Then quit PenPilot (only one copy runs at a time, so the portable test needs it closed).

### Test B: portable PenPilot

The "old" portable is **1.0.0** and the "new" one is **1.0.1**. Download both from the releases
page into `$env:TEMP\pp-dl` and check their SHA-256:

| File | SHA-256 |
|---|---|
| PenPilot-Portable-1.0.0.exe | `7c43171fd806151390fa69ba6e3948703f38af2447795de3c8446d384cf72c17` |
| PenPilot-Portable-1.0.1.exe | `86d45ba80ad83f25d569902c22263dd3ebbbdef3ed0e6c5a3fcfbc960df494ce` |

```powershell
cd C:\pp-helper
$dl = "$env:TEMP\pp-dl"
$t = "$env:USERPROFILE\Desktop\pp-portable-test"
New-Item -ItemType Directory $t -Force | Out-Null
Copy-Item "$dl\PenPilot-Portable-1.0.0.exe" $t
$launcher = Start-Process "$t\PenPilot-Portable-1.0.0.exe" -ArgumentList '--remote-debugging-port=9333' -PassThru
Start-Sleep 15
$main = Get-CimInstance Win32_Process -Filter "Name='PenPilot.exe' AND ParentProcessId=$($launcher.Id)" | Select-Object -First 1
node try-helper.mjs portable $main.ProcessId $launcher.Id "$dl\PenPilot-Portable-1.0.1.exe" "$t\PenPilot-Portable-1.0.0.exe" "$t\PenPilot-Portable-1.0.1.exe"
```

1.0.0 will offer the 1.0.1 update after a few seconds: **don't press it**, just leave the card.

Check, and report each:

1. "Helper is running", one *Waiting…* line, and PenPilot stays open until you close it.
2. Close it: `(Get-Process -Id $main.ProcessId).CloseMainWindow()`.
3. The log shows *PenPilot closed*, *Copied the new version to …*, *Opened PenPilot* and
   *Removed the old version*. The test folder now holds **only** `PenPilot-Portable-1.0.1.exe`.
4. PenPilot is open again by itself, and `info()` says **1.0.1**.

If anything goes wrong, capture the log, which step it stopped at, and what's running
(`Get-Process PenPilot, powershell -ErrorAction SilentlyContinue | Format-Table Id, ProcessName, StartTime, Path`)
rather than retrying many times.

**Report Part 1** in `PenPilot-windows-results-2.md` on the Desktop and show it to the owner, so they
can paste it into the Mac session. If it passes, he'll release 1.0.2 and come back for Part 2.

## Part 2: the real update (only once the owner says 1.0.2 is released)

1. **Old copies are left alone:** start the installed 1.0.1, use **Help → Check for updates…**.
   It should say *You have the newest PenPilot (1.0.1)*. That's on purpose: 1.0.1's own
   updater is the broken one.
2. **Install 1.0.2 by hand:** download `PenPilot-Setup-1.0.2.exe` from the releases page, check
   its SHA-256 against `windows.sha256` in that release's `latest.json`, then quit PenPilot and
   run `Start-Process .\PenPilot-Setup-1.0.2.exe -ArgumentList '/S' -Wait`.
3. **The update itself, in the app:** start 1.0.2 pretending to be 1.0.1, so it offers 1.0.2 again:

   ```powershell
   $env:PENPILOT_TEST_VERSION = '1.0.1'
   Start-Process "$env:LOCALAPPDATA\Programs\PenPilot\PenPilot.exe" -ArgumentList '--remote-debugging-port=9333'
   Remove-Item Env:PENPILOT_TEST_VERSION   # PenPilot already has it; keep it out of later commands
   ```

   After about 15 seconds the card says **PenPilot 1.0.2 is ready / You have 1.0.1**. Press
   **Update now** (as in the first test). Expected: *Downloading…*, then *Installing… PenPilot
   will close now and open again by itself on the new version in about a minute.*, PenPilot
   closes, and about a minute later **it opens again by itself**, with no update card this time
   (the reopened copy drops the test setting). Report `$env:TEMP\penpilot-update-1.0.2\update.log`.
4. **Portable, in the app:** download `PenPilot-Portable-1.0.2.exe` (check `windowsPortable.sha256`),
   put it in a test folder renamed to `PenPilot-old.exe`, and start it the same way with
   `PENPILOT_TEST_VERSION=1.0.1`. Update now → it closes, then reopens as
   `PenPilot-Portable-1.0.2.exe` in that folder, and `PenPilot-old.exe` is gone.
5. **Small fixes:** the sidebar scrollbar is thin and light purple. **Plotter check → Technical
   details** lists COM1 as *(access refused)* under *Serial devices seen (PenPilot only uses an
   AxiDraw, 04D8:FD92)*.

**Report Part 2** in the same file, one line per check: **pass**, **fail** or **not tested**.
