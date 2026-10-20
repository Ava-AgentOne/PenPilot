# Brief for a Claude session on a Windows VM: test PenPilot on Windows

You're helping **the owner** test **PenPilot** on Windows. PenPilot is their desktop app for the
**AxiDraw V3** pen plotter: drawings, photos and text become pen lines, and it plots them. It
has been built and fully tested on his Mac. **Windows has never been run on a real machine**:
GitHub's build check only proves it installs and opens. Your job is to test it here and report.

Explain things to the owner in plain language. Don't change PenPilot's code or push to any repo:
**test and report only.** Never make the plotter move unless the owner says the plotter is ready
(paper in, pen in), and only for the steps that say so.

## What's already known

- Installers are public on **https://github.com/Ava-AgentOne/penpilot-releases/releases**:
  **1.0.0** and **1.0.1** (the newest). Each release has `PenPilot-Setup-<v>.exe` (installer),
  `PenPilot-Portable-<v>.exe` (no install), and `latest.json` (what the app reads for updates,
  with each file's SHA-256).
- On Windows, PenPilot talks to the plotter over **Web Serial** inside the app (on the Mac it
  uses a different, direct connection). It only ever opens the AxiDraw's board: USB
  **VID 04D8, PID FD92** ("EiBotBoard").
- PenPilot checks `https://github.com/Ava-AgentOne/penpilot-releases/releases/latest/download/latest.json`
  about 8 seconds after opening. When there's a newer version it shows a card,
  **"PenPilot X is ready"**, with **Update now**. On Windows that downloads the new Setup .exe,
  checks its SHA-256, waits for PenPilot to close, runs it silently
  (`--updated /S --force-run`), and PenPilot reopens on the new version. **This has never run
  for real: it's the most important test.**
- Only one PenPilot runs at a time. Double-clicking a `.penpilot` project opens it in PenPilot.
- 1.0.1 has Electron "fuses" set. Chromium's `--remote-debugging-port` still works (you'll use
  it to look inside the app), but Node's `--inspect` and `ELECTRON_RUN_AS_NODE` don't.

SHA-256 of the Windows files:

| File | SHA-256 |
|---|---|
| PenPilot-Setup-1.0.0.exe | `f93bedb168093dddda8a1b4c3d32ef15cfb4e385280dacf97e12cef15db025cd` |
| PenPilot-Portable-1.0.0.exe | `7c43171fd806151390fa69ba6e3948703f38af2447795de3c8446d384cf72c17` |
| PenPilot-Setup-1.0.1.exe | `030a15e6db6c3eb2907fa7e155bcc94e86c686f436d340dd41766510873a160c` |
| PenPilot-Portable-1.0.1.exe | `86d45ba80ad83f25d569902c22263dd3ebbbdef3ed0e6c5a3fcfbc960df494ce` |

## 0. The machine

Report: Windows edition and version, and the CPU type (`$env:PROCESSOR_ARCHITECTURE`:
AMD64 is a normal PC; ARM64 means Windows on ARM, which runs PenPilot in x64 translation).
Check whether the plotter is visible:

```powershell
Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match 'VID_04D8&PID_FD92' } | Format-List Status, Class, FriendlyName, InstanceId
```

You'll need **Node.js** to look inside the app. If `node -v` fails:
`winget install OpenJS.NodeJS.LTS` (then open a new PowerShell).

## 1. A small helper to look inside PenPilot

PenPilot's window can be inspected over Chrome's DevTools protocol when it's started with
`--remote-debugging-port=9333`. Save this as `cdp.mjs` in a scratch folder (not inside
PenPilot's folders):

```js
// node cdp.mjs eval "<js expression>"   |   node cdp.mjs shot out.png
const [mode, arg] = process.argv.slice(2);
const targets = await (await fetch("http://127.0.0.1:9333/json")).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
await new Promise((r) => (ws.onopen = r));
const send = (method, params = {}) =>
  new Promise((resolve) => { const n = ++id; pending.set(n, resolve); ws.send(JSON.stringify({ id: n, method, params })); });
if (mode === "eval") {
  const res = await send("Runtime.evaluate", { expression: arg, awaitPromise: true, returnByValue: true, userGesture: true });
  console.log(JSON.stringify(res.result?.result?.value ?? res.result, null, 2));
} else if (mode === "shot") {
  const res = await send("Page.captureScreenshot", { format: "png" });
  (await import("node:fs")).writeFileSync(arg, Buffer.from(res.result.data, "base64"));
  console.log("saved", arg);
}
process.exit(0);
```

Useful checks: `node cdp.mjs eval "(async () => (await window.penpilot.info()))()"` (version),
`node cdp.mjs eval "document.querySelector('.pp-update')?.innerText"` (the update card),
`node cdp.mjs shot screen.png` (a screenshot to show the owner).

## 2. Install 1.0.0 and test the update to 1.0.1 (most important)

1. Download `PenPilot-Setup-1.0.0.exe` from
   `https://github.com/Ava-AgentOne/penpilot-releases/releases/download/v1.0.0/PenPilot-Setup-1.0.0.exe`
   with `Invoke-WebRequest`, and check its SHA-256 (`Get-FileHash`) against the table.
2. Install it silently: `Start-Process .\PenPilot-Setup-1.0.0.exe -ArgumentList '/S' -Wait`.
   Find where it went (normally `$env:LOCALAPPDATA\Programs\PenPilot\PenPilot.exe`; search
   `$env:LOCALAPPDATA\Programs` if not). Check the Desktop and Start-menu shortcuts exist.
3. Start it with the debug port: `& "<path>\PenPilot.exe" --remote-debugging-port=9333`.
   The **welcome guide** shows on first open. Close it:
   `node cdp.mjs eval "document.querySelector('.pp-welcome-close')?.click()"`. If the **Plotter
   check** card is open, note what it says, then press its "Continue without plotter" or "Close"
   button the same way.
4. Wait about 15 seconds. The card **"PenPilot 1.0.1 is ready"** should appear (bottom right),
   saying "You have 1.0.0", with the 1.0.1 notes. Screenshot it for the owner.
5. Press **Update now**:
   `node cdp.mjs eval "[...document.querySelectorAll('.pp-update button')].find(b => b.textContent.trim() === 'Update now').click()"`.
   Expected: "Downloading… %" then "Installing…", then PenPilot closes, the installer runs
   silently, and **PenPilot opens again by itself** (without the debug port this time).
6. Check: the process is running again, and
   `(Get-Item "<path>\PenPilot.exe").VersionInfo.ProductVersion` is **1.0.1**. Quit it, start it
   again with `--remote-debugging-port=9333`, and confirm `penpilot.info()` says 1.0.1 and no
   update card appears. Look for leftovers in `$env:TEMP\penpilot-update-1.0.1` (fine if there).

If anything goes wrong, capture exactly what happened (screenshots, the card's text, whether
the old or new version is installed, any error windows) rather than retrying many times.

## 3. Everyday checks (on 1.0.1)

Start PenPilot with the debug port each time you need to look inside.

- **The window:** the menu bar inside the window shows File, Edit, View, Window, Help. Screenshot.
- **Adding things:** `+ Add` menu → Rectangle, Circle, Text. They appear on the page; **Plot time** shows.
  (Click via `cdp.mjs eval` with `document.querySelectorAll("button")` and their text.)
- **Undo:** the toolbar's Undo removes the last added shape (its `aria-label` starts with "Undo").
- **Single copy:** with PenPilot open, start it again normally: no second window should open.
- **Project by double-click:** create `test.penpilot` with this content, then
  `Start-Process .\test.penpilot`. PenPilot should come to the front with a drawing called
  "Test box".

  ```json
  {"format":"penpilot-project","version":1,"app":"test","paper":{"width":297,"height":210,"margin":20},"pens":[],"items":[{"id":"x","name":"Test box","paths":[{"s":"#000000","g":"","p":[0,0,60,0,60,40,0,40,0,0]}],"bounds":{"minX":0,"minY":0,"maxX":60,"maxY":40},"x":50,"y":50,"scale":1,"rotation":0,"shape":{"kind":"rect","w":60,"h":40,"radius":0,"lines":1,"gap":2}}]}
  ```

- **Plotter check without the plotter:** the status button at the top says "Plotter not
  connected" (or what it says instead).
- **Portable:** quit PenPilot, download `PenPilot-Portable-1.0.1.exe` (check the SHA-256), run
  it: it should open the same way.

## 4. With the plotter (only if the VM can see it, and only with the owner ready)

Only if step 0 found the plotter (USB passed through to the VM). Ask the owner before anything moves.

1. The status button should say **Plotter ready**. Open it (click it) and report every line,
   especially the **firmware version** and "motor power".
2. The owner sets up the pen as on the Mac: **Pen → Lower**, adjust **down height** in **Edit pen
   settings**, **Raise**, **Test square**. (Advanced → Reverse pen direction may need ticking:
   it did on the Mac.)
3. The owner adds a drawing, presses **Frame**, then **Plot**. Report whether it plots like on the Mac.
4. Optional, with the owner: during a plot, unplug the USB. PenPilot should stop with "The plotter
   stopped answering…" and, once plugged back in, offer **Continue from line**.

## Report back

Write `PenPilot-windows-results.md` on the Desktop and show it to the owner, so they can paste it to
the Mac session. One line per check: **pass / fail / not tested**, plus details for anything
that failed or looked different (exact messages, screenshots' file names, versions). Include
the machine details from step 0.
