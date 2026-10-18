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
});
