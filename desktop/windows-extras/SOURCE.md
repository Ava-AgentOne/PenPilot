# Windows extras: where these files come from

PenPilot's Windows build carries two official AxiDraw / EiBotBoard (EBB) files.
They are copied unchanged from Evil Mad Scientist's EggBot repository, at commit
[`8f7fb31`](https://github.com/evil-mad/EggBot/tree/8f7fb319ec6507b2f1a60d9a9acd4e5f1ff95f71/EBB_firmware).
That repository is GPL-3.0 (see `LICENSE-GPL-3.0.txt`).

| File | What it's for | Upstream path | SHA-256 |
|---|---|---|---|
| `driver/mchpcdc.inf` | USB driver setup file for the EBB board. Only needed on Windows 8 and older; Windows 10/11 have it built in. | `EBB_firmware/EBB_inf/mchpcdc.inf` | `b5c73f9246ad446bca1e68edaff0f4870bbae9a131b03aabfdcfc866bca72e9a` |
| `driver/mchpcdc.cat` | Microchip's signature catalogue for the driver above. | `EBB_firmware/EBB_inf/mchpcdc.cat` | `a3a0f4ac5f9302751a67936849beff84171a1a6c2879ee000edbe69e76c95119` |
| `firmware-updater/EBBUpgraderGUI_v317.exe` | Official firmware updater. It updates the board to firmware 3.1.7 and has the firmware file and flashing tool built in. | `EBB_firmware/EBBUpdater/EBBUpgraderGUI_v317.exe` | `4c9b62e22d279cb1173700484487654b90bc6ec0c3313fc3416ba292a86aa6e0` |

The driver uses Windows' own `usbser.sys`. The `.inf` file only tells Windows to
use that driver for the EBB (`USB\VID_04D8&PID_FD92`).

PenPilot never changes these files. It ships them as separate tools inside the
Windows build (`resources/windows-extras/`) and runs them only when you press
**Install driver** or **Update firmware** on the Plotter check screen.
