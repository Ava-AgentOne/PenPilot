# Pens test (build step 6, first half)

About 20 minutes on the Mac, plus plotting time. You need: the plotter, an A4 sheet, and
**two pens of different colours** (e.g. a black fineliner and a red or blue pen). Install
PenPilot 0.6.0 first (quit the old one, drag the new one into Applications, and choose
**Replace**).

Your old pen heights and speed are now the first pen, called **My pen**.

## 1. Set up your two pens

1. In **pens** (top left), rename **My pen** to your black pen's name, e.g. `Black fineliner`.
   Set its **line width** (0.3–0.5 mm for a fineliner).
2. Press **Lower pen**. Nudge **down height** up or down with the little arrows: the pen moves
   as you change it. Stop when the tip just touches the paper. **Raise pen** to finish.
3. Press **Test square**. A 10 mm square is drawn in the paper's corner by the home position,
   with its left half filled. The filled half should look **solid**: if you see gaps, make the
   line width smaller; if it blotches, make it bigger. (The fill lines are one line width apart.)
4. Press **New pen**, name it e.g. `Red gel pen`, pick its **colour**, and set its heights the
   same way (swap the pen in the plotter, Lower pen, adjust, Test square). Each test square goes
   a little further along the edge.

## 2. A two-pen plot

1. Choose **Black fineliner** in the pens list, then **Add text** and type `Hello`.
2. Choose **Red gel pen** in the pens list, then **Add text** again and type `World`. Move it
   under the first one.
   (Or open the drawing of your choice and pick **drawn with** in its settings. An SVG with
   several line colours offers **Split into one drawing per colour**.)
3. On screen, each text shows in its pen's colour, as thick as the pen draws.
4. The **plot** section says **2 pens, in this order**. Put the **black** pen in, then **Plot**.
5. After the black text, the carriage parks in its home corner, PenPilot chimes and asks
   **Put in ● Red gel pen**. Swap the pen (Lower pen / Raise pen help you fit it) and press
   **Continue**. The red text is drawn with the red pen's own heights.

## 3. Stop, and continue from a line

1. Plot again on a fresh sheet (or move the drawings to a blank area). Partway through,
   press **Stop**. The pen lifts and the carriage drives back to its home corner.
2. The plot section shows **Stopped after … lines**. The lines already drawn show in teal.
   Use **◀ 1** / **◀ 10** to step back a few lines (as if the pen had run dry), then press
   **Continue from line …**. It drives to that line and carries on. If that line belongs to
   the other pen, it asks you to put that pen in first.
3. Also try **Pause** during a plot: the pen lifts at the end of the current line. You could
   swap the pen now. **Resume** carries on.

## Report back

- Did each pen draw with its **own heights** (black and red both touching properly)?
- Did the **pen change** stop in the right place and continue cleanly?
- After **Stop** and **Continue from line**, did it carry on in the **right place**, with no
  shift?
- Did the **test square's** filled half help you pick the line width?
