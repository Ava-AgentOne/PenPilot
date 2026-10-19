# Windows PC test

This is the first test on the Windows PC. About 30 minutes. Copy these from the Mac
(`PenPilot/release/windows/`) to the PC, e.g. on a USB stick:
`PenPilot-Setup-0.9.2.exe`, `PenPilot-Portable-0.9.2.exe`, `penpilot-test.svg`, and a
project you saved on the Mac (e.g. `Card.penpilot`).

## 1. Install and first open

1. Run **PenPilot-Setup-0.9.2.exe**. Windows may say "Windows protected your PC": press
   **More info** → **Run anyway** (only this once; the app isn't paid-signed).
2. Install with the normal choices. PenPilot opens, with the new icon on the desktop and in
   the Start menu. The welcome guide appears: read it, then **Start**.

## 2. Plotter check

1. Plug in the plotter's USB cable and its power adapter. The **Plotter check** runs by itself
   (later, click the plotter status button at the top, or **Help → Plotter check**).
2. You should see **Plotter ready**. If not, it says what's wrong in plain words:
   - **Install driver** only appears on old Windows (8 or earlier). Press it if you see it.
   - **Firmware is old:** press **Update firmware**. It opens the official updater: follow it,
     then unplug and replug the plotter and press **Check again**.
3. Open **Advanced** and tick **Reverse pen direction** if **Raise** lowers the pen (it did on
   the Mac). Settings are kept per computer, so this needs doing once on the PC too.

## 3. Pens and a plot

1. Set up your pen as on the Mac: **Lower**, open **Edit pen settings** and adjust **down
   height** until it just touches, **Raise**, then **Test square**.
2. **+ Add → Drawing or photo…** → `penpilot-test.svg`. **Frame**, then **Plot**. It should
   look the same as from the Mac.

## 4. A project from the Mac

1. Double-click `Card.penpilot`. PenPilot opens it (if PenPilot was already open, in the same
   window). The pens it uses are added to the PC's pen list.
2. Plot it, or just check it looks as it did on the Mac.

## 5. Portable version (optional, 2 minutes)

Quit PenPilot, then run **PenPilot-Portable-0.9.2.exe** straight from the USB stick. It
should open and find the plotter without installing anything.

## Report back

- Did the Plotter check say **Plotter ready**? What firmware version did it show?
- Did the test plot and the Mac project plot correctly?
- The menu bar (File, Edit, View, Window, Help) sits inside the window on Windows: does it work?
- Anything that looked or worked differently from the Mac?
