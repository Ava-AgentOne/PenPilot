# Page editor test (build step 2)

About 10 minutes on the Mac. You need: the plotter (USB and power), an **A4 sheet**,
a pen, and tape. Install the new PenPilot first (quit the old one, drag the new one
into Applications, and choose **Replace**). If the pen was reversed before, the
**Reverse pen direction** tick-box is remembered.

## 1. Two drawings on one page

1. Press **Add drawing…** (in the new **drawings** section) and pick both
   `samples/penpilot-test.svg` and `samples/penpilot-star.svg`. You can also drag them in.
2. Try each of these:
   - **Move:** drag a drawing.
   - **Resize:** drag the round dot on its corner.
   - **Turn 90°**, **Centre** and **Fit page** buttons.
   - Type an exact **x / y / width / height** in mm.
   - **Arrow keys** nudge the selected drawing by 1 mm (with **Shift**, 10 mm). **Delete** removes it.
3. Put the frame drawing on the left half and the star on the right half, not touching.

## 2. Portrait, and Frame

1. Press **Portrait**. The page turns upright, and a note says to put the sheet in
   **sideways, top of the page on the left**. Arrange the two drawings on the tall page.
2. Tape the A4 sheet into the plotter **landscape**, with the top of your page on the
   **left**. Press **disengage motors** and slide the pen carriage to its home corner.
3. Press **Frame**. With the pen lifted, the plotter traces the rectangle your drawings
   will cover. Check that it sits where you expect on the sheet. Tick **keep going round**
   to repeat it until you press **Stop frame**.

## 3. Plot and watch the screen

1. Press **Plot**. While it draws:
   - lines already drawn turn **teal** on screen;
   - a small **red cross** follows the pen.
2. Check the drawing matches the screen: same layout, the right way up on the sheet
   (top of the page on the left side of the plotter).

## 4. Also try (no plotting needed)

- Choose **A3** paper. The part the V3 can't reach is **striped**, with a warning.
  Drag a drawing into the stripes: it gets a red box and a ⚠ in the list.
- Choose **Custom**, type 150 × 100, name it "Card" and press **Save size**. It now
  appears in the paper list as **★ Card**.
- Drop a JPG or PNG: PenPilot says photos come in a later step.

## Report back

- Did Frame trace the right area?
- Did the portrait plot come out the right way round, matching the screen?
- Did the teal "already drawn" lines and the red cross keep up with the pen?
- Anything awkward about moving or resizing?
