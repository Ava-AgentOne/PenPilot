// Direct USB-serial access to the plotter from the desktop shell (macOS).
//
// Why not Web Serial on the Mac: the EiBotBoard reports no USB serial number,
// so Chromium never pre-approves it and every launch had to go through
// navigator.serial.requestPort(). On macOS that also lists Bluetooth serial
// ports, on the main thread: a permission prompt for every new (ad-hoc signed)
// build, and the whole app frozen until it's answered. Node's serialport
// (prebuilt, N-API, no Bluetooth) avoids all of that.
//
// The renderer gets a byte stream per open port over IPC and drives the
// EiBotBoard with saxi's EBB class exactly as it would over Web Serial.

const { ipcMain } = require("electron");
const { SerialPort } = require("serialport");
const { isEBB } = require("./serial-match.cjs");

const POLL_MS = 1500;

/** @type {Map<number, {port: import("serialport").SerialPort, sender: Electron.WebContents}>} */
const open = new Map();
let nextId = 1;

async function listPlotters() {
  // serialport reports ids as lowercase hex strings ("04d8"), which isEBB reads as hex.
  const ports = await SerialPort.list();
  return ports.filter((p) => isEBB({ vendorId: p.vendorId, productId: p.productId })).map((p) => p.path);
}

function setUpNativeSerial() {
  ipcMain.handle("penpilot:native-serial-list", () => listPlotters());

  ipcMain.handle("penpilot:native-serial-open", async (event, path) => {
    // Only ever open a port that is a plotter right now.
    const plotters = await listPlotters();
    if (!plotters.includes(path)) throw new Error("That port is not a plotter.");
    const port = await new Promise((resolve, reject) => {
      const p = new SerialPort({ path, baudRate: 9600 }, (err) => (err ? reject(err) : resolve(p)));
    });
    const id = nextId++;
    const sender = event.sender;
    open.set(id, { port, sender });
    port.on("data", (chunk) => {
      if (!sender.isDestroyed()) sender.send("penpilot:native-serial-data", id, new Uint8Array(chunk));
    });
    port.on("close", () => {
      open.delete(id);
      if (!sender.isDestroyed()) sender.send("penpilot:native-serial-closed", id);
    });
    port.on("error", (err) => console.error("Plotter serial error:", err.message));
    return { id, path };
  });

  ipcMain.handle("penpilot:native-serial-write", (_event, id, bytes) => {
    const entry = open.get(id);
    if (!entry) throw new Error("Plotter connection is closed.");
    return new Promise((resolve, reject) => {
      entry.port.write(Buffer.from(bytes), (err) => {
        if (err) reject(err);
        else entry.port.drain((err2) => (err2 ? reject(err2) : resolve()));
      });
    });
  });

  ipcMain.handle("penpilot:native-serial-close", (_event, id) => {
    const entry = open.get(id);
    if (!entry) return;
    open.delete(id);
    return new Promise((resolve) => entry.port.close(() => resolve()));
  });

  // Tell windows when a plotter appears or disappears (Web Serial's connect /
  // disconnect events, for the native path).
  let last = "";
  setInterval(async () => {
    let now;
    try {
      now = (await listPlotters()).join("\n");
    } catch {
      return;
    }
    if (now === last) return;
    last = now;
    const { webContents } = require("electron");
    for (const wc of webContents.getAllWebContents()) {
      if (!wc.isDestroyed()) wc.send("penpilot:native-serial-changed", now ? now.split("\n") : []);
    }
  }, POLL_MS);
}

module.exports = { setUpNativeSerial };
