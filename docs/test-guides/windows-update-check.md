# PenPilot Windows Update Check

Thank you for testing PenPilot on this VM. Your first report found why Windows updates never
finished, and your Part 1 check found the one thing still wrong in the fix. **1.0.2 is now
out as a test release**: normal copies of PenPilot can't see it, so other users aren't offered
it yet. This is the last check before it goes to everyone.

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
- **From your Part 1 check:** the helper is now started the way you proved works: a short-lived
  PowerShell (spawned normally, with a hidden console) starts it with `Start-Process -WindowStyle Hidden`,
  so it has its own console and outlives PenPilot. The helper script itself is unchanged.
- PenPilot only closes once the helper has written its first log line, so a helper that can't
  start shows a message instead of PenPilot just disappearing.
- Each step goes to `update.log` next to the downloaded file.
- 1.0.0 and 1.0.1 won't be offered updates any more (their updater is the broken one). The feed
  lists Windows files under new names that only 1.0.2 and later read. Windows copies get 1.0.2
  by hand once.
- Small fixes from your notes: the sidebar scrollbar is thin and purple on Windows; Plotter check
  → Technical details now says which ports were refused (your COM1 was never used).

## Part 1 (done)

Your Part 1 check passed with that start method: installed (reinstall 1.0.1) reopened after
22 s, portable (1.0.0 → 1.0.1) after 10 s, no window flashing. 1.0.2 uses exactly that.

## Part 2: the real update inside PenPilot

The test release's update file (only read when you point PenPilot at it):
`https://github.com/Ava-AgentOne/penpilot-releases/releases/download/v1.0.2/latest.json`.
Its files are on the same release page,
`https://github.com/Ava-AgentOne/penpilot-releases/releases/tag/v1.0.2`.

1. **Old copies are left alone.** Start the installed **1.0.1** pointed at the test feed, then
   use **Help → Check for updates…**. It should say *You have the newest PenPilot (1.0.1)*,
   because 1.0.1's updater is the broken one and the feed no longer lists files it reads.

   ```powershell
   $env:PENPILOT_UPDATE_FEED = 'https://github.com/Ava-AgentOne/penpilot-releases/releases/download/v1.0.2/latest.json'
   Start-Process "$env:LOCALAPPDATA\Programs\PenPilot\PenPilot.exe" -ArgumentList '--remote-debugging-port=9333'
   Remove-Item Env:PENPILOT_UPDATE_FEED   # PenPilot already has it; keep it out of later commands
   ```

   Then quit PenPilot.
2. **Install 1.0.2 by hand:** download `PenPilot-Setup-1.0.2.exe` from the test release, check
   its SHA-256 against `windows.sha256` in that `latest.json`, then
   `Start-Process .\PenPilot-Setup-1.0.2.exe -ArgumentList '/S' -Wait`. Check
   `(Get-Item "$env:LOCALAPPDATA\Programs\PenPilot\PenPilot.exe").VersionInfo.ProductVersion` is 1.0.2.
3. **The update itself, in the app:** start 1.0.2 pretending to be 1.0.1 and pointed at the
   test feed, so it offers 1.0.2 again:

   ```powershell
   $env:PENPILOT_UPDATE_FEED = 'https://github.com/Ava-AgentOne/penpilot-releases/releases/download/v1.0.2/latest.json'
   $env:PENPILOT_TEST_VERSION = '1.0.1'
   Start-Process "$env:LOCALAPPDATA\Programs\PenPilot\PenPilot.exe" -ArgumentList '--remote-debugging-port=9333'
   Remove-Item Env:PENPILOT_UPDATE_FEED, Env:PENPILOT_TEST_VERSION
   ```

   After about 15 seconds the card says **PenPilot 1.0.2 is ready / You have 1.0.1**. Press
   **Update now** (as in the first test). Expected: *Downloading…*, then *Installing… PenPilot
   will close now and open again by itself on the new version in about a minute.*, PenPilot
   closes, and **it opens again by itself**. The reopened copy drops both test settings, so it
   reads the normal update file (still 1.0.1) and shows **no** update card. `info()` says 1.0.2.
   Report `$env:TEMP\penpilot-update-1.0.2\update.log` and the time from closing to reopening.
4. **Portable, in the app:** quit PenPilot. Download `PenPilot-Portable-1.0.2.exe` (check
   `windowsPortable.sha256`), put it in a new test folder renamed to `PenPilot-old.exe`, and
   start it with the same two settings (as in step 3, with that path). Update now → it closes,
   then reopens as `PenPilot-Portable-1.0.2.exe` in that folder, and `PenPilot-old.exe` is gone.
5. **Small fixes:** the sidebar scrollbar is thin and light purple. **Plotter check → Technical
   details** lists COM1 as *(access refused)* under *Serial devices seen (PenPilot only uses an
   AxiDraw, 04D8:FD92)*.

If anything goes wrong, capture the log, the step it stopped at, and what's running
(`Get-Process PenPilot, powershell -ErrorAction SilentlyContinue | Format-Table Id, ProcessName, StartTime, Path`)
rather than retrying many times.

**Report** in `PenPilot-windows-results-3.md` on the Desktop, one line per check: **pass**,
**fail** or **not tested**, and show it to the owner so they can paste it into the Mac session. If it
passes, 1.0.2 goes to everyone.
