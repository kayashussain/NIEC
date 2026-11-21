# ISR design brief: how every screen must look, move and feel

The owner's standing instruction (20 Nov 2026). Every change to a page, a card, a window or a style follows this file. CLAUDE.md
points here, so every session reads it before front-end work. The front end is the product. ISR is treated as an Apple product:
premium, calm, quiet and exact. The measure is apple.com itself, not "inspired by" it.

## 0. The prompt (paste this whenever you ask for front-end work)

> You are Apple's own design and web engineering team (the designer, the front-end engineer and the person who signs it off).
> Build this screen of ISR, a premium product, as Apple would ship it on apple.com: calm, quiet, exact, expensive-feeling.
> Read CLAUDE.md and DESIGN.md first and follow them to the letter, especially section 2 (the measured Apple values).
> - Colour: near-black #1d1d1f and one grey #6e6e73 for text; blue (#0071e3 buttons, #0066cc links) only for the one main
>   action, links and "where you are now". No gradients, no coloured icons, no coloured panels, no glow. A colour appears only
>   when it means something (an orange dot for missing, green for done, red for an error).
> - Type: Apple's scale (17px body, line height 1.47, letter spacing -0.022em; headings weight 600 with tighter spacing). Sharp
>   and large; never thin, never pale.
> - Space: generous. Sections separated by space and a hairline, never by boxes inside boxes.
> - Motion: short and quiet: hovers and presses on Apple's timings (colour 0.32s, background 0.1s, curve cubic-bezier(.4, 0, .6, 1));
>   things that appear glide in over 0.5s on cubic-bezier(.16, 1, .3, 1) (the curve of the award-winning sites).
>   No bounce, no confetti, no pop-ups or notifications that the person did not ask for, nothing that follows the mouse, nothing
>   sticky that slides in.
> - Every action still answers: a button says what it is doing (Saving..., then Saved with a tick), a mistake shows a short red
>   line and a gentle shake of the field.
> - Never a second copy of a feature that already exists on the page.
> Check it in a real browser at 1440px and 1280px next to apple.com, click everything, look for any overlap, cut text or console
> error on every page you touched, then have an independent reviewer score it against apple.com (9/10 or more on every screen)
> before you hand it back. Follow CLAUDE.md for the 🔴 CSS marks, the log and the reply.

## 1. The feeling

- **Calm and premium at rest, precise in use.** A page is quiet: lots of space, black text on soft grey and off-white, one blue.
  When someone acts, the page answers at once and quietly (a colour change, a word, a tick), never with a show.
- **Confidence comes from restraint.** Fewer colours, fewer borders, fewer words, fewer effects. What remains is placed exactly.
- **The details people feel without noticing** (they decide whether something feels premium):
  - text that is large, dark and tightly set, with even spacing everywhere
  - one grey only for secondary words, so the eye knows what is less important
  - buttons that react in a tenth of a second (a slow button feels cheap)
  - everything lined up on the same edges; the same gap used again and again
  - nothing moves unless the person did something; nothing blinks, pulses, shines or follows the mouse
  - no surprise windows or notifications; the person is never interrupted
  - hairlines instead of boxes; one level of panels, never a box inside a box inside a box
  - the same control always looks the same on every page

## 2. Fixed values (measured on apple.com, 20 Nov 2026)

| What | Apple's value | In ISR |
|---|---|---|
| Body text | 17px, line height 25px (1.47), letter spacing -0.374px (-0.022em), weight 400 | the same |
| Small text and labels | 14px, line height 20px, letter spacing -0.224px (-0.016em) | the same |
| Headings | weight 600; 40px (line 44px), 28px (line 32px), 21px (line 25px); 80px hero with -0.015em | page and card titles 40px, section titles 21 to 24px |
| Text colours | #1d1d1f; secondary #6e6e73 | the same, nothing lighter than #6e6e73 |
| Links | #0066cc | the same |
| Main button | #0071e3, white 17px words, pill (980px radius), 44px tall, about 22px each side | the same |
| Other buttons | grey pill (#e8e8ed, hover #dcdce2) with black words; or a blue outline pill | grey pill |
| Page and panels | page #f5f5f7, tiles white with 18 to 28px corners, no border, no shadow | page #f5f5f7, panels soft off-white #fbfbfd (never pure white), 22 to 28px corners, a barely visible shadow |
| Rules | hairlines | 1px #e8e8ed |
| Top bar | 44px, rgba(245, 245, 247, .8) with saturate(180%) blur(20px) | the menu keeps its own place; nothing extra sticks to the top |
| Text rendering | antialiased | antialiased, optimizeLegibility |
| Colour change on hover | 0.32s cubic-bezier(.4, 0, .6, 1) | the same |
| Background change on hover or press | 0.1s linear | the same; a pressed button dims to 85% |
| Items appearing (menus) | opacity and 8 to 12px movement, 0.24 to 0.32s, 80ms apart | 0.5s on the ease-out-expo glide (section 2a), 8px, 40ms apart |
| Tile hover | a slight scale over 0.3s cubic-bezier(0, 0, .5, 1) | only on picture tiles; never on text panels |
| Page change | none (the new page simply appears) | a 0.2s fade |
| Bounce, glow, confetti, light under the mouse | none | none |

- **Light theme only** (no dark mode, no extra themes). **One font**, the system font (SF Pro on Apple), Inter elsewhere
  (`--font`). No serif.
- **Easy on older eyes:** large type, 44px targets for main actions, contrast passing WCAG AA, motion never in the way of reading.
- Only the consultancy's logo (menu, login). Its name is a stored setting, never written into code.
- **Never a second copy of a feature that already exists on the page.** Make the existing control better instead.
- Pictures: never black, white, blank, blurry, a poster, a banner with text, a ceremony, or a logo used as a photo; never the same
  picture twice on a page; a picture that fails is removed gracefully.
- Fewer words: titles, numbers and short labels.
- **Desktop and laptop first** (until the owner asks for phones). Phone styles already in the code stay as they are.
- **Text size, the same for everyone by default (the owner, 21 Nov 2026).** On a laptop or desktop every page shows at the size the
  owner liked at 67% browser zoom (`html[data-size="small"]`, CSS `zoom: .67`). The account menu has **Text size: Small, Medium,
  Large** (0.67, 0.8, 1), kept in the browser per person, for anyone who finds it small; it never goes bigger than the page as built.
  Pages inside the card drawer are not zoomed twice (`data-size="framed"`). Because of the zoom: place any menu or popup with
  `isrPos` (`shared/ui.js`), never with raw `getBoundingClientRect` or `innerWidth`; write a full-height size as
  `calc(100vh / var(--isr-z, 1))` or with `inset`, never plain `100vh`.
- **Less glare (the owner, 21 Nov 2026):** canvas #eef0f3, panels #f8f9fb (a cool off-white, never cream or yellow); on the student
  card the Profile column #f1f3f6 and edit boxes #fdfdfe. Screens of work are flat: surfaces meet edge to edge with hairlines, not
  cards floating with margins on every side.

## 1a. The owner's direction for screens of work (21 Nov 2026)

- **A portal, not a brochure.** Use the whole width; one bar across the top, the profile on the left, the work on the right (as
  ApplyBoard, Adventus and Route2Uni do). No card inside a card, no wide empty margins; panels with a hairline and 18 to 24px inside.
- **Interactive, not just numbers and words.** What can be changed is changed where it is shown (press, type, Enter); what is
  missing is an empty box waiting; a press does the next useful thing (open the next missing detail, record the offer, start a note).
- **Colour only from the brand, and little of it.** The consultancy's blue and orange (from its logo) and Apple's action blue: blue for
  actions, links and "where the student is now", orange for what is missing; everything else near-black, grey and off-white. Like
  Apple giving Mac and iPhone their own colour, a page may lean on one brand colour, never on many.
- **Motion that helps:** the line of steps draws, entries rise in as they come into view, a tab slides from the side chosen, a saved
  detail shows a tick. No drifting colour, tilting tiles or bouncing.

## 2a. What the owner's award-winning reference sites teach (studied 20 Nov 2026)

The owner sent Awwwards winners as references: Lusion, KPR, Mana, Mammut, Wix Studio, Synchronized, Noomo, Rouser, The Year of
Greta, 5S, Amanda Braga, Cappen (and Ed, Superhero Cheesecake, Plink, Autumn, Chungi Yoo, Prometheus Fuels, which did not open
from the cloud). Measured in a browser:
- **One font family, one or two weights.** Every one of them. Character comes from size and space, not from many styles.
- **Almost no colour in text:** black or white (Lusion, Cappen, KPR, Mammut); one accent at most (KPR's lime, Rouser's yellow).
- **The glide:** things appear on an ease-out-expo curve, a fast start and a long soft stop, over 0.5 to 0.9s
  (Lusion `cubic-bezier(.4, 0, .1, 1)`, Mammut `cubic-bezier(.19, 1, .22, 1)`, 5S `cubic-bezier(.075, .82, .165, 1)`,
  Cappen `cubic-bezier(.25, 1, .5, 1)`). This is what makes them feel smooth and expensive. ISR uses `cubic-bezier(.16, 1, .3, 1)`
  over 0.5s for things that appear, and Apple's 0.1 to 0.32s for hovers and presses.
- **Small, exact hover reactions:** an arrow nudges, a line grows, a colour changes; never a big jump.
- **Lots of space and a strict grid;** text set large and quiet.
- What ISR does **not** take: 3D scenes, loaders, illustration overload, scroll shows. They are for marketing pages; ISR is a tool
  people work in all day, and must stay fast and calm.

## 3. The motion kit (use it; do not reinvent it)

`shared/motion.js` is loaded on every page by `header.js`. Its styles are the "ISR motion kit" section of `shared/theme.css`,
set to Apple's timings above.

| Piece | How to use it | What it does |
|---|---|---|
| Rise in | `Motion.reveal(container, '.selector')` | the elements fade in and rise 8px with the glide (0.5s), 40ms apart, each once |
| Count up | `Motion.countUp(el, number, { format })` | a number counts up; the final text is always exact |
| Celebrate | `Motion.celebrate(x, y, big)` | confetti; only where the owner asked for it (finishing work on Today), never on opening a page |
| Progress ring | `Motion.ring(done, total, { size, stroke, label })` | an SVG ring that fills |
| Press | automatic (CSS) on buttons, pills, tabs | quick colour change, a slight dim while pressed |
| Page change | automatic (CSS view transitions) | a 0.2s fade |
| Less motion | `Motion.reduced()` | true when the person asked for less motion, and in automated tests |

- Animate only `transform` and `opacity`. Nothing moves for a reader who asked for less motion.
- Automated tests see final values at once (the kit skips motion when `navigator.webdriver` is set).
- New pieces join the kit when a second page needs them (for example the loading outline or the Saving, Saved button of the
  student card).

## 4. A checklist for every screen

1. **First look:** is it calm? One blue, black and grey text, space, hairlines. Would it sit on apple.com without looking out of
   place?
2. **Every action answers, quietly:** a press changes colour at once; a save says Saving..., then Saved with a tick; an error shows a
   short red line and the field shakes gently.
3. **Nothing the person did not ask for:** no pop-ups on opening, no notifications, no confetti, no sticky bars, no pulsing.
4. **Loading and empty:** a grey outline shaped like the content while loading; when empty, a grey symbol, one line and the next step.
5. **Keyboard:** Ctrl/Cmd+K is the existing quick search (never a second one); Escape closes; a page's own keys are listed under `?`.
6. **Nothing breaks:** no console errors, no layout jump, no overlap, no cut text, no sideways scrolling, on every page touched.
7. **Accessible:** focus rings, `aria` labels on icon buttons, anything that moves on its own can be paused and stops off screen.

## 5. How to work (every front-end change)

1. Read CLAUDE.md and this file. Work on the latest `master`.
2. Look at apple.com (it is allowed in this project's cloud environment) and measure what you are matching.
3. Write a short plan for the screen (what it shows first, how it answers, what is removed), then build all of it.
4. Check it in a real browser at 1440px and 1280px: click every control, open every window, no console errors, and walk every page
   for overlaps and cut text.
5. **Run an independent reviewer agent** as a strict Apple judge, comparing with apple.com. Fix everything below 9 and review again
   until every screen scores 9 or more.
6. Run `npm test` (all of it) before pushing.
7. Follow CLAUDE.md: mark every CSS change with the 🔴 comment, log it in CSS-CHANGES.md, start the reply with the 🔴 CSS CHANGED
   list, no em or en dashes, demo data is called made up.

## 6. Pages so far

| Page | Done | Still to come |
|---|---|---|
| Student card | a working portal (the owner, 21 Nov 2026, as ApplyBoard): the whole width, a profile bar with the progress steps, the Profile on the left with every detail changed where it is shown (Enter saves with a tick, Escape cancels, "N to add" opens the next missing one), the work on the right; brand colours used sparingly (blue for actions and now, orange for missing); its own stylesheet `student-details/student-card.css` | waiting for the owner's approval before the other pages follow |
| Every page | the kit at Apple's timings: quick colour on press, 0.2s page fade, no mouse light, no spring | each page brought to the calm system, one at a time |
| Today | the greeting, a progress ring of the day, counting numbers, rising rows, confetti for finished tasks | the greeting shine and the confetti to be checked against the calm rule with the owner |
| Universities (university pages) | cover slideshow with pause, gallery fades, rising cards, counting amounts | moving to the calm system |
