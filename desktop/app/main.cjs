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
