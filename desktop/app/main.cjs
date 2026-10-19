// PenPilot desktop shell.
//
// Loads saxi's browser UI (built with IS_WEB=1, so it talks to the plotter over
// Web Serial) from a private app:// scheme, and quietly answers Chromium's
// "which serial port?" question with the AxiDraw's EiBotBoard, so the user never
// sees a port picker. Everything runs in this one app: no Node.js, Python or
// saxi server for the user to install.

const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, session, shell } = require("electron");
const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { EBB_PRODUCT_ID, EBB_VENDOR_ID, isEBB, usbIds } = require("./serial-match.cjs");

const UI_DIR = path.join(__dirname, "ui");
// Windows-only helpers (driver + firmware updater) ship as extraResources.
const WINDOWS_EXTRAS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "windows-extras")
  : path.join(__dirname, "..", "windows-extras");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Every serial device Chromium has asked us about, for the Plotter check's
// "Technical details" (helps diagnose a plotter that isn't recognised).
const seenSerialDevices = new Map();
function rememberSerialDevice(port, via) {
  if (!port) return;
  const { vendorId, productId } = usbIds(port);
  const name = port.displayName || port.portName || port.name || "";
  const hex = (n) => (Number.isNaN(n) ? "????" : n.toString(16).padStart(4, "0").toUpperCase());
  seenSerialDevices.set(`${via}:${hex(vendorId)}:${hex(productId)}:${name}`, {
    id: `${hex(vendorId)}:${hex(productId)}`,
    name,
    via,
    isPlotter: isEBB(port),
    raw: JSON.stringify(port),
  });
}

function setUpSerial(ses) {
  // navigator.serial.requestPort(): pick the plotter ourselves instead of
  // showing a chooser. An empty id makes requestPort() reject with NotFoundError,
  // which the Plotter check screen turns into "plotter not found".
  ses.on("select-serial-port", (event, portList, _webContents, callback) => {
    event.preventDefault();
    for (const port of portList) rememberSerialDevice(port, "picker");
    const ebb = portList.find(isEBB);
    callback(ebb ? ebb.portId : "");
  });
  ses.setPermissionCheckHandler((_webContents, permission) => permission === "serial");
  // Lets navigator.serial.getPorts() see a plugged-in plotter without a click.
  ses.setDevicePermissionHandler((details) => {
    if (details.deviceType !== "serial") return false;
    rememberSerialDevice(details.device, "pre-approval");
    return isEBB(details.device);
  });
}

// The UI only ever loads its own bundled files. The planner runs in a blob: worker.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
].join("; ");

function setUpAppProtocol() {
  protocol.handle("app", async (request) => {
    const { pathname } = new URL(request.url);
    const relative = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
    const filePath = path.normalize(path.join(UI_DIR, relative));
    if (!filePath.startsWith(UI_DIR + path.sep)) {
      return new Response("Not found", { status: 404 });
    }
    const response = await net.fetch(pathToFileURL(filePath).toString());
    if (!filePath.endsWith(".html")) return response;
    const headers = new Headers(response.headers);
    headers.set("Content-Type", "text/html; charset=utf-8");
    headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    return new Response(response.body, { status: response.status, headers });
  });
}

// ---- Finding the plotter ----------------------------------------------------

// Is an EiBotBoard physically plugged in, according to the OS itself?
// (Independent of Chromium's serial permissions; see requestPlotterPort.)
function plotterPresent() {
  if (process.platform === "darwin") {
    return new Promise((resolve) => {
      execFile("ioreg", ["-p", "IOUSB", "-l", "-w0"], { timeout: 10000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
        if (error) return resolve(null);
        // ioreg prints one property block per USB device, starting at "+-o".
        const blocks = String(stdout).split("+-o ");
        resolve(
          blocks.some(
            (b) => b.includes(`"idVendor" = ${EBB_VENDOR_ID}`) && b.includes(`"idProduct" = ${EBB_PRODUCT_ID}`),
          ),
        );
      });
    });
  }
  if (process.platform === "win32") return windowsDeviceStatus().then((s) => (s.error ? null : !!s.present));
  return Promise.resolve(null);
}

// Chromium only pre-approves (getPorts) a USB serial device on macOS when it
// reports a USB serial number; an EiBotBoard without a nickname may not. In
// that case grant it the way a browser would, via requestPort() -- answered by
// our select-serial-port handler, so no chooser is shown. On macOS this can
// trigger a one-time "use Bluetooth?" question, because Chromium also lists
// Bluetooth serial ports; PenPilot doesn't need Bluetooth either way.
async function requestPlotterPort(webContents) {
  try {
    return await webContents.executeJavaScript(
      `navigator.serial.requestPort({ filters: [{ usbVendorId: ${EBB_VENDOR_ID}, usbProductId: ${EBB_PRODUCT_ID} }] }).then(() => true, () => false)`,
      true,
    );
  } catch {
    return false;
  }
}

// ---- Windows helpers -------------------------------------------------------

function runPowerShell(command) {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
      { windowsHide: true, timeout: 20000 },
      (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout).trim(), stderr: String(stderr).trim() }),
    );
  });
}

// Does Windows see an EBB, and does it have a working driver for it?
async function windowsDeviceStatus() {
  if (process.platform !== "win32") return { supported: false };
  const result = await runPowerShell(
    "Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match 'VID_04D8&PID_FD92' } | " +
      "Select-Object Status, Class, FriendlyName | ConvertTo-Json -Compress",
  );
  if (!result.ok) return { supported: true, error: result.stderr || "PowerShell failed" };
  if (!result.stdout) return { supported: true, present: false };
  let devices = JSON.parse(result.stdout);
  if (!Array.isArray(devices)) devices = [devices];
  const working = devices.some((d) => d.Status === "OK");
  return {
    supported: true,
    present: true,
    working,
    devices: devices.map((d) => ({ status: d.Status, class: d.Class, name: d.FriendlyName })),
  };
}

// Installs the bundled EBB driver. Windows asks for admin permission once.
async function installWindowsDriver() {
  if (process.platform !== "win32") return { ok: false, message: "Only needed on Windows." };
  const inf = path.join(WINDOWS_EXTRAS_DIR, "driver", "mchpcdc.inf");
  if (!fs.existsSync(inf)) return { ok: false, message: `Driver file missing: ${inf}` };
  // "pnputil -i -a" works on Windows 7, 8, 10 and 11.
  const escaped = inf.replace(/'/g, "''");
  const result = await runPowerShell(
    `$p = Start-Process -FilePath pnputil.exe -ArgumentList '-i','-a','"${escaped}"' -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode`,
  );
  return result.ok
    ? { ok: true, message: "Driver installed. Unplug the plotter's USB cable and plug it back in." }
    : { ok: false, message: result.stderr || "The driver was not installed (permission was refused or Windows reported an error)." };
}

function openFirmwareUpdater() {
  if (process.platform !== "win32") return { ok: false, message: "The official firmware updater only runs on Windows." };
  const exe = path.join(WINDOWS_EXTRAS_DIR, "firmware-updater", "EBBUpgraderGUI_v317.exe");
  if (!fs.existsSync(exe)) return { ok: false, message: `Updater missing: ${exe}` };
  const child = spawn(exe, [], { cwd: path.dirname(exe), detached: true, stdio: "ignore" });
  child.unref();
  return { ok: true };
}

// ---- Project files ------------------------------------------------------------
//
// The UI never names a file to write itself: it can only save to a file the
// user picked in a Save or Open dialog during this session.

const FILE_KINDS = {
  project: { name: "PenPilot project", extensions: ["penpilot"] },
  svg: { name: "SVG drawing", extensions: ["svg"] },
};
const pickedFiles = new Set();
let lastFolder = null;

function remember(file) {
  pickedFiles.add(file);
  lastFolder = path.dirname(file);
  return { ok: true, path: file, name: path.basename(file) };
}

async function saveFileAs(win, kind, suggestedName, text) {
  const filter = FILE_KINDS[kind];
  if (!filter || typeof text !== "string") return { ok: false, message: "Nothing to save." };
  const base = path.basename(String(suggestedName || "Untitled")).replace(/[\\/:*?"<>|]/g, "-");
  const result = await dialog.showSaveDialog(win, {
    defaultPath: path.join(lastFolder || app.getPath("documents"), base),
    filters: [filter],
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  let file = result.filePath;
  if (!file.toLowerCase().endsWith(`.${filter.extensions[0]}`)) file += `.${filter.extensions[0]}`;
  await fs.promises.writeFile(file, text, "utf8");
  return remember(file);
}

async function saveFileTo(file, text) {
  if (!pickedFiles.has(file) || typeof text !== "string") return { ok: false, message: "Choose where to save it first." };
  await fs.promises.writeFile(file, text, "utf8");
  return remember(file);
}

async function openProject(win) {
  const result = await dialog.showOpenDialog(win, {
    defaultPath: lastFolder || app.getPath("documents"),
    filters: [FILE_KINDS.project],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true };
  const file = result.filePaths[0];
  const text = await fs.promises.readFile(file, "utf8");
  return { ...remember(file), text };
}

// ---- Opening a project by double-clicking it ---------------------------------------
//
// macOS sends "open-file" (even at launch); Windows starts PenPilot with the
// file's path as an argument, or -- when PenPilot is already open -- passes it
// to the running copy ("second-instance"). The UI asks for files once it's
// ready (take-open-files) and gets any later ones as "penpilot:open-file".

const waitingFiles = [];
let uiWantsFiles = false;

function projectArg(argv) {
  return argv.slice(1).find((a) => typeof a === "string" && a.toLowerCase().endsWith(".penpilot") && fs.existsSync(a));
}

async function readProjectFile(file) {
  try {
    const text = await fs.promises.readFile(file, "utf8");
    return { ...remember(file), text };
  } catch {
    return { ok: false, name: path.basename(file), message: `PenPilot couldn't read “${path.basename(file)}”.` };
  }
}

async function openFileFromSystem(file) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  if (uiWantsFiles && win) win.webContents.send("penpilot:open-file", await readProjectFile(file));
  else waitingFiles.push(file);
}

function setUpIpc() {
  ipcMain.handle("penpilot:info", () => ({
    platform: process.platform,
    version: app.getVersion(),
    electron: process.versions.electron,
  }));
  ipcMain.handle("penpilot:windows-device-status", () => windowsDeviceStatus());
  ipcMain.handle("penpilot:serial-devices", () => [...seenSerialDevices.values()]);
  ipcMain.handle("penpilot:plotter-present", () => plotterPresent());
  ipcMain.handle("penpilot:request-plotter-port", (event) => requestPlotterPort(event.sender));
  ipcMain.handle("penpilot:install-driver", () => installWindowsDriver());
  ipcMain.handle("penpilot:open-firmware-updater", () => openFirmwareUpdater());
  // Draw the user's eye when the plot needs them (e.g. to change pen) while
  // PenPilot is in the background: bounce the Dock icon / flash the taskbar.
  ipcMain.handle("penpilot:attention", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isFocused()) return;
    if (process.platform === "darwin") app.dock?.bounce("critical");
    else {
      win.flashFrame(true);
      win.once("focus", () => win.flashFrame(false));
    }
  });
  ipcMain.handle("penpilot:save-file-as", (event, kind, name, text) =>
    saveFileAs(BrowserWindow.fromWebContents(event.sender), kind, name, text),
  );
  ipcMain.handle("penpilot:save-file", (_event, file, text) => saveFileTo(file, text));
  ipcMain.handle("penpilot:open-project", (event) => openProject(BrowserWindow.fromWebContents(event.sender)));
  ipcMain.handle("penpilot:take-open-files", async () => {
    uiWantsFiles = true;
    const files = waitingFiles.splice(0);
    return Promise.all(files.map(readProjectFile));
  });
  ipcMain.handle("penpilot:open-external", (_event, url) => {
    if (typeof url === "string" && /^https:\/\//.test(url)) shell.openExternal(url);
  });
}

// ---- Menu bar ---------------------------------------------------------------
//
// File actions live here (not in the side panel); each item tells the UI what
// to do ("penpilot:menu"). Edit keeps copy/paste/undo working in text boxes.

function setUpMenu() {
  const mac = process.platform === "darwin";
  const send = (command) => (_item, win) =>
    (win ?? BrowserWindow.getAllWindows()[0])?.webContents.send("penpilot:menu", command);
  const template = [
    ...(mac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "New", accelerator: "CmdOrCtrl+N", click: send("new") },
        { label: "Open…", accelerator: "CmdOrCtrl+O", click: send("open") },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: send("save") },
        { label: "Save as…", accelerator: "Shift+CmdOrCtrl+S", click: send("save-as") },
        { type: "separator" },
        { label: "Export SVG…", accelerator: "CmdOrCtrl+E", click: send("export-svg") },
        ...(mac ? [{ type: "separator" }, { role: "close" }] : [{ type: "separator" }, { role: "quit", label: "Exit" }]),
      ],
    },
    {
      // Undo / Redo go to the page (or, while typing, to the text box: the UI decides).
      label: "Edit",
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", click: send("undo") },
        { label: "Redo", accelerator: mac ? "Shift+Cmd+Z" : "Ctrl+Y", click: send("redo") },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        { type: "separator" },
        { label: "Duplicate drawing", accelerator: "CmdOrCtrl+D", click: send("duplicate") },
      ],
    },
    {
      // Zoom works on the page, not the whole window.
      label: "View",
      submenu: [
        { label: "Zoom in", accelerator: "CmdOrCtrl+=", click: send("zoom-in") },
        { label: "Zoom in", accelerator: "CmdOrCtrl+Plus", click: send("zoom-in"), visible: false },
        { label: "Zoom out", accelerator: "CmdOrCtrl+-", click: send("zoom-out") },
        { label: "Fit the page", accelerator: "CmdOrCtrl+0", click: send("zoom-fit") },
        { type: "separator" },
        { label: "Show or hide pen-up moves", click: send("toggle-travel") },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "Welcome guide", click: send("help") },
        { label: "Plotter check", click: send("plotter-check") },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  app.setAboutPanelOptions({
    applicationName: "PenPilot",
    applicationVersion: app.getVersion(),
    credits: "Based on saxi by Jeremy Rose and contributors (AGPL-3.0).",
  });
}

// ---- Window ----------------------------------------------------------------

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "PenPilot",
    backgroundColor: "#f6f6f6",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  // Links open in the normal browser; the app window never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("app://")) event.preventDefault();
  });
  // The page has changes that aren't saved: ask before closing.
  win.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: "question",
      buttons: ["Close without saving", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      message: "Close PenPilot?",
      detail: "Your page has changes that aren't saved. Use Save first to keep them.",
    });
    if (choice === 0) event.preventDefault(); // close anyway
  });
  win.loadURL("app://penpilot/index.html");
}

// One PenPilot at a time: two copies would fight over the plotter. A second
// launch (e.g. double-clicking a project on Windows) hands over to this one.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const file = projectArg(argv);
    if (file) openFileFromSystem(file);
    else {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    }
  });
  const atLaunch = projectArg(process.argv);
  if (atLaunch) waitingFiles.push(atLaunch);
}
app.on("open-file", (event, file) => {
  event.preventDefault();
  if (app.isReady()) openFileFromSystem(file);
  else waitingFiles.push(file);
});

app.whenReady().then(() => {
  if (!gotLock) return; // another PenPilot is already open
  setUpAppProtocol();
  setUpSerial(session.defaultSession);
  setUpIpc();
  setUpMenu();
  // macOS talks to the plotter directly (see native-serial.cjs for why).
  if (process.platform === "darwin") require("./native-serial.cjs").setUpNativeSerial();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
