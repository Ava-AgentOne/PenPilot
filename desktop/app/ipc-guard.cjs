// Only PenPilot's own screens (loaded from app://penpilot) may call the desktop
// shell. Nothing else can load in the window anyway (see main.cjs), but every
// handler checks, so a stray page could never save files, drive the plotter or
// install an update.

function fromPenPilot(event) {
  const url = event.senderFrame?.url ?? "";
  return url.startsWith("app://penpilot/");
}

/** ipcMain.handle, for PenPilot's own screens only. */
function handle(ipcMain, channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!fromPenPilot(event)) throw new Error("Not allowed.");
    return fn(event, ...args);
  });
}

module.exports = { handle };
