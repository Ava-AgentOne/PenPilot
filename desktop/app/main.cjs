// PenPilot desktop shell.
//
// Loads saxi's browser UI (built with IS_WEB=1, so it talks to the plotter over
// Web Serial) from a private app:// scheme, and quietly answers Chromium's
// "which serial port?" question with the AxiDraw's EiBotBoard, so the user never
// sees a port picker. Everything runs in this one app: no Node.js, Python or
// saxi server for the user to install.

const { app, BrowserWindow, ipcMain, net, protocol, session, shell } = require("electron");
const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const EBB_VENDOR_ID = 0x04d8;
const EBB_PRODUCT_ID = 0xfd92;

const UI_DIR = path.join(__dirname, "ui");
// Windows-only helpers (driver + firmware updater) ship as extraResources.
const WINDOWS_EXTRAS_DIR = app.isPackaged
  ? path.join(process.resourcesPath, "windows-extras")
  : path.join(__dirname, "..", "windows-extras");

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// Electron reports USB ids as decimal strings ("1240"); be lenient about hex too.
function parseUsbId(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || value === "") return Number.NaN;
  return /^\d+$/.test(value) ? Number(value) : Number.parseInt(value, 16);
}

function isEBB(port) {
  return (
    port != null &&
    parseUsbId(port.vendorId) === EBB_VENDOR_ID &&
    parseUsbId(port.productId) === EBB_PRODUCT_ID
  );
}

function setUpSerial(ses) {
  // navigator.serial.requestPort(): pick the plotter ourselves instead of
  // showing a chooser. An empty id makes requestPort() reject with NotFoundError,
  // which the Plotter check screen turns into "plotter not found".
  ses.on("select-serial-port", (event, portList, _webContents, callback) => {
    event.preventDefault();
    const ebb = portList.find(isEBB);
    callback(ebb ? ebb.portId : "");
  });
  ses.setPermissionCheckHandler((_webContents, permission) => permission === "serial");
  // Lets navigator.serial.getPorts() see a plugged-in plotter without a click.
  ses.setDevicePermissionHandler((details) => details.deviceType === "serial" && isEBB(details.device));
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

function setUpIpc() {
  ipcMain.handle("penpilot:info", () => ({
    platform: process.platform,
    version: app.getVersion(),
    electron: process.versions.electron,
  }));
  ipcMain.handle("penpilot:windows-device-status", () => windowsDeviceStatus());
  ipcMain.handle("penpilot:install-driver", () => installWindowsDriver());
  ipcMain.handle("penpilot:open-firmware-updater", () => openFirmwareUpdater());
  ipcMain.handle("penpilot:open-external", (_event, url) => {
    if (typeof url === "string" && /^https:\/\//.test(url)) shell.openExternal(url);
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
  win.loadURL("app://penpilot/index.html");
}

app.whenReady().then(() => {
  setUpAppProtocol();
  setUpSerial(session.defaultSession);
  setUpIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
