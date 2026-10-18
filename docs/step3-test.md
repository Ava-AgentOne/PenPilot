# Tracing and photo test (build step 3)

About 15 minutes on the Mac, plus plotting time. You need: the plotter (USB and power),
an **A4 sheet**, a fine pen (0.3–0.5 mm works best for photos), tape, and **one photo**:
a face or an object with clear light and dark areas. Install PenPilot 0.3.1 first (quit
the old one, drag the new one into Applications, and choose **Replace**).

## 0. Trace a line drawing (the main use)

1. Add a **line drawing** as an image (like the hand JPG). It's traced straight away as
   **Trace: centre lines**: one pen stroke down the middle of each line.
2. If lines are missing or broken, raise **Threshold**. If dirt or specks show up, raise
   **Remove specks**. **Simplify** and **Smoothing** make the lines cleaner and rounder.
3. Add your **ghfh.svg**. PenPilot warns that it's made of filled shapes (a pen would
   draw every line twice). Press **Trace centre lines instead**.
4. Plot one of them: it should come out as single, clean lines.

## 1. Turn a photo into line art

1. Press **Add drawing or photo…** and pick your photo (JPG, PNG, WebP, GIF), or drag it in.
   It fills the page and starts as a trace. Pick an art style from the **Style** list. The photo shows faintly behind the lines
   while it's selected.
2. Try a few **styles** from the list. Good first picks: **Spiral** and **Peano** (one
   continuous line), **Stipples** (dots), **Linedraw** (outlines + hatching), **Waves**.
   - The status under the sliders shows progress ("Iteration 12", "Tracing contours…"),
     then how many pen strokes the result has.
   - The **Duration** at the bottom updates once the lines settle. Photos can take
     **20 minutes to 2+ hours**. Dot styles take longest, because the pen goes down
     once per dot.
3. Adjust the sliders:
   - **Brightness**, **Contrast** and **Inverted** change how dark the result is.
   - Each style's own sliders change line count, spacing and so on.
   - **Detail (px)** is how fine a version of the photo the style works from. Higher means
     more detail and a longer plot.
4. Move, resize and turn the photo like any drawing.

## 2. Plot a short one first

1. Pick **Spiral** or **Squiggle**, make the photo about **100 mm wide**, and check the
   Duration is under about 10 minutes.
2. Line up the paper, press **Frame** to check the area, then **Plot**.
3. Watch the screen: lines already drawn turn teal and the red cross follows the pen.

## Report back

- Which styles did you like, and did any of them fail or take far too long to appear?
- Did the plot look like the screen (darkness, size, position)?
- Was the time estimate about right?
- Anything confusing about the sliders?
