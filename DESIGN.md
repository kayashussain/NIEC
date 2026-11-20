# ISR design brief: how every screen must look, move and feel

The owner's standing instruction (20 Nov 2026). Every change to a page, a card, a window or a style follows this file. CLAUDE.md
points here, so every session reads it before front-end work. The front end is the product: the team works in ISR all day, and
it must feel premium, alive and rewarding, like a beautifully made game, while staying fast and clear for real work.

## 1. The feeling

- **Premium and calm at rest, alive in use.** At rest a page is clean, light and quiet (Apple). The moment someone acts, it
  answers: things rise, press, glow, count, fill and celebrate.
- **A small surprise on every visit.** A greeting that shines, numbers that count up, a ring that fills, rows that arrive one after
  another, confetti when work is finished. Never the same dead screen twice.
- **Work that feels like progress.** Show progress as rings and bars that fill, and celebrate milestones:
  - a task finished: a burst of confetti
  - everything done today: one big burst, once a day
  - students moving through stages, like levels
  Elegant, never childish. Think of the rings in Apple Fitness and the rewards in Duolingo, made with the restraint of Apple.
- **Benchmarks** (the owner keeps no links, so these name the standard):
  - apple.com product pages: space, type, the sense of quality
  - Linear and Raycast: speed, keyboard, crisp motion
  - Stripe and Vercel: depth, light, gradients that move slowly
  - Things 3 and Apple Fitness: satisfying completion
  - Awwwards Site of the Day: surprise
  The owner asked for more than the Apple website, which feels static.

## 2. Fixed brand rules (never break)

- Apple design language, **light theme only** (no dark mode, no extra themes).
- Colours:

  | Use | Colour |
  |---|---|
  | Canvas | `#f5f5f7` |
  | Panels | soft off-white, never pure white |
  | Text | `#1d1d1f` |
  | Primary action | blue pill `#0071e3` |
  | Other actions | grey pills |
  | Tabs | segmented |

- **One font**, the system font (SF Pro on Apple), Inter elsewhere (`--font`). No serif.
- **Easy on older eyes:**
  - large type and large buttons
  - tap targets of at least 44px
  - contrast passing WCAG AA
  - grey text never lighter than `#6e6e73`
  - motion never makes text hard to read
- Only the consultancy's logo (menu, login). Its name is a stored setting, never written into code.
- **Never a second copy of a feature that already exists on the page.** Make the existing control better instead.
- Pictures:
  - never black, white, blank, blurry, a poster, a banner with text, a ceremony, or a logo used as a photo
  - never the same picture twice on a page
  - a picture that fails is removed gracefully
- Fewer words: titles, numbers and short labels.
- **Desktop and laptop first** (until the owner asks for phones). Phone styles already in the code stay as they are.

## 3. The motion kit (use it; do not reinvent it)

`shared/motion.js` is loaded on every page by `header.js` (and directly by a page that needs it before it draws). Its styles are
the "ISR motion kit" section of `shared/theme.css`.

| Piece | How to use it | What it does |
|---|---|---|
| Rise in | `Motion.reveal(container, '.selector')` | the matching elements rise and fade in one after another (42ms apart), each once |
| Count up | `Motion.countUp(el, number, { format })` | a number counts up; the final text is always exact |
| Celebrate | `Motion.celebrate(x, y, big)` | confetti from a point; `big` for a milestone |
| Progress ring | `Motion.ring(done, total, { size, stroke, label })` | an SVG ring that fills (green to blue) with the percentage counting up |
| Cursor light | automatic on cards (list in `motion.js`) | a soft blue light follows the mouse over cards with a plain background |
| Press | automatic (CSS) on buttons, pills, tabs | a small spring when pressed, a blue glow on the primary button |
| Page change | automatic (CSS view transitions) | pages cross-fade into each other |
| Less motion | `Motion.reduced()` | true when the person asked for less motion, and in automated tests |

Motion tokens:

- **Spring:** `--mo-spring` (`cubic-bezier(.34, 1.56, .64, 1)`), for presses and pops.
- **Smooth ease-out:** `--mo-out` (`cubic-bezier(.2, .8, .2, 1)`), for entrances.
- **Durations:**

  | Use | Time |
  |---|---|
  | Press | 0.2s |
  | Entrance | 0.6s |
  | Ring | 1.3s |
  | Celebration | 1.7s (2.6s big) |

- Animate only `transform` and `opacity` (60 frames a second).
- Nothing moves for a reader who asked for less motion; the page still works the same.
- Automated tests see final values at once (the kit skips motion when `navigator.webdriver` is set).

New pieces join the kit when a second page needs them, for example skeleton loading, morphing buttons (Save, Saving, Saved),
drag with physics, or shared-element transitions.

## 4. A checklist for every screen

1. **First second:** what catches the eye (a greeting, a ring, a hero picture) and what rises in.
2. **Every action answers:**
   - a press springs
   - a save confirms (a tick, a toast)
   - an error shakes gently, with a friendly line
   - a finish celebrates
3. **Progress is visible:** rings, bars and counts for the work of the day or the stage of a student.
4. **Hover is rich:** cards lift slightly, the light follows the mouse, and details appear without clutter.
5. **Empty and loading states are designed:** skeleton shimmer while loading, and for empty a small icon, one line and the next
   step.
6. **Keyboard:**
   - Ctrl/Cmd+K is the existing command palette; do not add a second one
   - `/` focuses the page's search
   - Escape closes
7. **Nothing breaks:**
   - no console errors
   - no layout jump
   - no text over a picture without a shade under it
8. **Accessible:**
   - focus rings
   - `aria` labels on icon buttons
   - anything that moves on its own has a pause button and stops when off screen

## 5. How to work (every front-end change)

1. Read CLAUDE.md and this file. Work on the latest `master`.
2. Write a short interaction plan for the screen (first second, what moves, reward moments, keyboard), then build all of it.
3. Check it in a real browser:
   - take screenshots at 1440px
   - click every control
   - step through the motion
   - no console errors
4. **Run an independent reviewer agent** as a strict Apple and Awwwards judge. It scores the delight, motion, clarity,
   accessibility and speed of each screen out of 10. Fix everything below 9 and review again until every screen scores 9 or more.
5. Run `npm test` (all of it) before pushing.
6. Follow CLAUDE.md:
   - mark every CSS change with the 🔴 comment
   - log it in CSS-CHANGES.md
   - start the reply with the 🔴 CSS CHANGED list
   - no em or en dashes
   - demo data is called made up

## 6. Pages on the motion kit so far

| Page | What is done | Still to come |
|---|---|---|
| Today | the greeting shine; a progress ring of the day; numbers count up; task rows rise in; confetti for each finished task, and a big burst once a day when everything is done | |
| Universities (university pages) | cover slideshow with pause; gallery fades; course and level cards rise in; amounts count up | moving to the shared kit |
| Every page | the cursor light on cards, the press spring, page cross-fades | |
