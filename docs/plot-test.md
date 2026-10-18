# First plot test (build step 1)

Do this once on the **Mac** and once on the **Windows PC**. It takes about 5 minutes each.
You need: the AxiDraw with its **USB cable and power adapter**, one A4 sheet, a pen,
and some tape.

## 1. Install

**Mac:** open `release/PenPilot-0.1.0-mac-arm64.dmg`, drag PenPilot into Applications,
and open it. Because it was built on this Mac, there's no security warning.

**Windows:** copy the `release/windows` folder to the PC (USB stick or shared folder).
Then either run `PenPilot-Setup-0.1.0.exe` to install, or double-click
`PenPilot-Portable-0.1.0.exe` to run it without installing. If Windows says
"Windows protected your PC", press **More info → Run anyway** (first time only).

## 2. Plotter check

1. Plug in the plotter's **power adapter**, then its **USB cable**.
2. PenPilot opens the **Plotter check** by itself. You want four green ticks:
   plugged in, can talk to it, firmware, motor power.
3. If a Mac asks about **Bluetooth**, either answer is fine.
4. If anything isn't green, open **Technical details** and send a screenshot
   of the whole Plotter check window.
5. Note the **firmware number** it shows (for example "Firmware 2.8.1").

## 3. Set up the pen and paper

1. Press **disengage motors**. Then gently slide the pen carriage to its **home corner**:
   all the way to the left, and with the arm pushed all the way in toward the plotter's body.
2. Tape an **A4 sheet landscape** (long side left to right), with its top-left
   corner just under the pen.
3. Put the pen in the holder. Press **pen up**, then **pen down**.
   - If **pen up** lowers the pen and **pen down** lifts it, tick **Reverse pen direction**
     (under the two buttons) and try again. This is common on AxiDraw-compatible
     clones. PenPilot remembers the setting.
   - On **pen down** the tip should just touch the paper. If it doesn't, raise
     **down height** (for example 60 → 70) and press **pen down** again. Then press **pen up**.

## 4. Plot

1. Drag `samples/penpilot-test.svg` into the PenPilot window (or press **Upload SVG**).
   For now only **SVG drawings** work. Photos (JPG/PNG) come in build step 3, and PenPilot
   will say so if you drop one.
   You'll see a rounded frame, a circle, a star and a zig-zag. The time estimate
   should say about **45 s**.
2. Press **Plot**. Keep a hand near the plotter. **Pause** and **Cancel** work at any time.

## 5. Report back

- Did all four ticks go green? Which firmware number did it show?
- Did the drawing come out complete, clean, and in the right place on the paper?
- Anything odd: missed lines, pen dragging between shapes, wrong size?
