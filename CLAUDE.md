# PenPilot — rules for Claude sessions

**What this is:** a standalone desktop app (Electron) for the AxiDraw V3 pen
plotter: a Saxi fork plus photo-to-line styles, single-line text and hatch fill,
for Mac and Windows. Updates ship through the public
`Ava-AgentOne/penpilot-releases` repo.

**Where things are:** `README.md` (for users), `PLAN.md`, `ARCHITECTURE.md`,
`CHANGELOG.md`. Private working notes are in `DEV-LOG.private.md`, which is
git-ignored — never commit it.

## Rules that matter

1. **This repo is public. No personal details, ever** — no maintainer name, no
   email, no personal or household references, in files, commits, release notes
   or built binaries. Commits must use the repo-local noreply identity: check
   `git config user.email` before committing.
2. **README:** icon, top features, install, updates, a short dev section and the
   licence. No build-step history.
3. **Every release lists its changes** — `desktop/scripts/publish-release.mjs`
   writes the release body from the notes. A release goes out as a test
   pre-release first and is promoted afterwards.
4. **On the Mac, the plotter check must never touch `navigator.serial`.**
   Chromium's pre-approval can't work with this board (it reports no USB serial
   number), so the Mac uses serialport directly. Windows still uses Web Serial.
5. **Any per-item setting that changes the drawn lines goes in the `geometry`
   replan list in `src/ui.tsx`** — otherwise Plot draws the old lines.
6. Hatching: don't switch back to clipper2-js; its offsets were wrong.
7. **Stop always lifts the pen and drives home**, and Pause re-lifts the pen
   before continuing.
8. Windows updates run through `desktop/app/windows-update.cjs` (a PowerShell
   helper, unit-tested). Its working directory must never be the install
   directory.
