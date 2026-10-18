// Exposes a small, fixed set of desktop-only helpers to the UI as window.penpilot.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("penpilot", {
  platform: process.platform,
  info: () => ipcRenderer.invoke("penpilot:info"),
  windowsDeviceStatus: () => ipcRenderer.invoke("penpilot:windows-device-status"),
  serialDevices: () => ipcRenderer.invoke("penpilot:serial-devices"),
  plotterPresent: () => ipcRenderer.invoke("penpilot:plotter-present"),
  requestPlotterPort: () => ipcRenderer.invoke("penpilot:request-plotter-port"),
  installDriver: () => ipcRenderer.invoke("penpilot:install-driver"),
  openFirmwareUpdater: () => ipcRenderer.invoke("penpilot:open-firmware-updater"),
  openExternal: (url) => ipcRenderer.invoke("penpilot:open-external", url),
  attention: () => ipcRenderer.invoke("penpilot:attention"),
  saveFileAs: (kind, name, text) => ipcRenderer.invoke("penpilot:save-file-as", kind, name, text),
  saveFile: (file, text) => ipcRenderer.invoke("penpilot:save-file", file, text),
  openProject: () => ipcRenderer.invoke("penpilot:open-project"),
  takeOpenFiles: () => ipcRenderer.invoke("penpilot:take-open-files"),
  onMenu: (fn) => {
    const h = (_e, command) => fn(command);
    ipcRenderer.on("penpilot:menu", h);
    return () => ipcRenderer.removeListener("penpilot:menu", h);
  },
  onOpenFile: (fn) => {
    const h = (_e, file) => fn(file);
    ipcRenderer.on("penpilot:open-file", h);
    return () => ipcRenderer.removeListener("penpilot:open-file", h);
  },
  // macOS only: direct USB-serial access to the plotter (desktop/app/native-serial.cjs).
  nativeSerial:
    process.platform === "darwin"
      ? {
          list: () => ipcRenderer.invoke("penpilot:native-serial-list"),
          open: (path) => ipcRenderer.invoke("penpilot:native-serial-open", path),
          write: (id, bytes) => ipcRenderer.invoke("penpilot:native-serial-write", id, bytes),
          close: (id) => ipcRenderer.invoke("penpilot:native-serial-close", id),
          onData: (fn) => {
            const h = (_e, id, bytes) => fn(id, bytes);
            ipcRenderer.on("penpilot:native-serial-data", h);
            return () => ipcRenderer.removeListener("penpilot:native-serial-data", h);
          },
          onClosed: (fn) => {
            const h = (_e, id) => fn(id);
            ipcRenderer.on("penpilot:native-serial-closed", h);
            return () => ipcRenderer.removeListener("penpilot:native-serial-closed", h);
          },
          onChanged: (fn) => {
            const h = (_e, paths) => fn(paths);
            ipcRenderer.on("penpilot:native-serial-changed", h);
            return () => ipcRenderer.removeListener("penpilot:native-serial-changed", h);
          },
        }
      : undefined,
});
