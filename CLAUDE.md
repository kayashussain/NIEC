# Standing rules for this project

## The live server

**Before any work on the live server, read [LIVE-SERVER.md](LIVE-SERVER.md)** (studentrecruit360.com/niec, set up 25 Nov 2026).

## Rule 0: QUESTIONS TO THE OWNER ARE ALWAYS MULTIPLE CHOICE (STRICT, MANDATORY, the owner, 23 Nov 2026) ***

**\*\*\* NEVER ASK THE OWNER A QUESTION INSIDE A PARAGRAPH OR A SENTENCE. \*\*\***

- **Every question goes through the AskUserQuestion tool as a multiple-choice question** (2 to 4 short options, the recommended one first
  and marked "(Recommended)"). The owner picks an option, or picks "Other" and explains. This holds for every question, every time,
  in every session, however small, and also for the question that asks for feedback at the end of a piece of work.
- **The owner does not have time to read paragraphs.** Replies are short: the "🔴 CSS CHANGED" part (Rule 1) first, then a few plain
  lines of what was done, what was checked, and what the owner should look at. No long paragraphs, no questions hidden inside them.
- If a reply has no question, it says so by simply ending. If it has one, the question is the multiple-choice card, not text.
- Never forget this and never repeat the mistake. If an earlier reply broke it, fix the next one.

## Rule 00: FINISH THE WORK COMPLETELY, THEN SAY "USE IT" (STRICT, the owner, 25 Nov 2026)

- **When the owner gives a task, do all of it, fully, before replying.** Do not hand back half work, a list of what is wrong, or "you could
  do this, I suggest that". If something is not fine, fix it yourself, test it, and only then report.
- **Check everything yourself first:** run the real pages at many browser zooms (50% to 300%), with the real demo accounts, look at the
  screenshots, fix what is wrong, run `npm test`, and only then tell the owner. Never ask the owner to check something you can check.
- **The final reply is: it is finished and tested, use it** (with the one thing that only the owner can do, if there is one, for example
  uploading to the live server). No "please check", no "tell me if you see a problem", no list of suggestions.
- **Do not ask the owner questions to get unstuck.** Choose the sensible default and say what was chosen. If a real decision is needed
  that only the owner can make (for example which access is needed), ask it as one multiple-choice question (Rule 0), after doing all
  the work that does not depend on the answer.
- **Do not repeat questions the owner already answered.** The owner's standing wishes are in this file: read it first, every session.

## Rule 0d: DESIGNS ARE SHOWN ON A LAPTOP SCREEN FIRST, AS AN ARTIFACT (STRICT, the owner, 23 Nov 2026)

- **Before any front-end change that is a design (not a bug fix), publish an artifact that shows it at laptop and desktop width
  (1440 px wide, with the real side menu, the real column width and the real text size), never a narrow or portrait mock-up.** The
  owner approves it, and only then is it built. What is built must look like the approved artifact on the owner's own screen.
- A difference between an approved design and the live site that was not asked about is reported to the owner as a multiple-choice
  question (Rule 0), and nothing is changed until the owner answers.

## Rule 0b: APPROVED ONCE MEANS DONE AND LIVE (STRICT, the owner, 23 Nov 2026)

- **When the owner has looked at a design or a plan and says go, approve, build or deploy, that is the approval for the whole job,
  including putting it on the live server.** Do all of it: build, test, review, push to `master`, update the live server (LIVE-SERVER.md),
  check the live server, and only then report.
- **Never split an approved job into parts and ask for approval again for each part** (for example: the opened task, then the window, then the tab).
  Do every part that was shown and approved in one go. Ask only when something truly new or different is needed, and then as a
  multiple-choice question (Rule 0).
- Before it is called finished, review it deeply as a user, as a developer and as a tester: no CSS or front-end crash, nothing broken on
  any size or state, the code read through, the tests run. Give it your best first; then ask for the owner's feedback (multiple choice).

## Rule 0c: HOW TO WORK WITH GITHUB RUNS AND THE LIVE SERVER (the owner, 23 Nov 2026; new server 25 Nov 2026)

- **Keep watching the Tests run until it is finished. Never wait a fixed time and never say "about 3 minutes".** Report success, or failure
  with the reason, the moment it finishes. Never skip or weaken a test to get green.
- **GitHub does not update the live server.** The live server is updated through cPanel, as LIVE-SERVER.md says.
- A change is live only after that upload and restart, and after the live check (`/healthz` and the login page) passed. Say so in the reply.

## Rule 1: every CSS change is marked, logged and announced (the owner asked for this, and it must never be skipped)

The owner is not a developer and wants to see every change to how the site looks. Whenever you change **any CSS**
(in `shared/theme.css`, `student-details/*.css`, a `<style>` block in any `.html` file, or a style set from JavaScript),
you must do **all three** of these, every time, even for a one-line change:

1. **Mark it in the code.** Put a comment directly above the change, in exactly this form:

   ```css
   /* 🔴 CSS CHANGED (2026-11-04): <what> | from: <old value or look> | to: <new value or look> */
   ```

   Several related changes in one block can share one comment. Never change CSS without this comment.

2. **Log it.** Add a line to `CSS-CHANGES.md` (newest at the top): date, file, what changed, from, to, and why.

3. **Tell the owner in your reply, at the top, before anything else.** Start the reply with a heading like
   `🔴 CSS CHANGED` followed by a short list: which file, what it looked like before, what it looks like now. If no CSS
   was changed in the turn, say so in one line (`CSS changed: none`). Do not bury it, do not summarise it away, and do
   not leave it out because the change was small or because it was a bug fix.

Text cannot be coloured in a terminal or in a code comment, so the red circle `🔴` is the "red" marker. Use it as above.

## Rule 2: there is one version of the code, on `master`, and no other branch (the owner asked for this)

The owner does not want old versions, copies or rewrites lying around, because a later reviewer could pick one up by mistake.

- **Work on `master` only.** Start every session and every review from the latest `master` (`git fetch origin`, then
  `git checkout master`, `git reset --hard origin/master`). Commit and push to `master`.
- **Never create another branch, tag, copy or "backup".** No `backup`, `old`, `v2`, `new` or dated branch, folder or file in
  git. Change a file in place; do not write a second version beside it.
- **If the tool you run in forces a branch on you** (some cloud sessions start on an automatic `claude/...` branch), merge it
  into `master` before you finish, say so at the top of the reply, and name the branch so the owner can delete it. Never
  leave work only on a branch. Finish with `git ls-remote --heads origin`: only `master` should be listed.
- **How to delete old branches.** Cloud sessions are often not allowed to delete a branch with `git push origin --delete`
  (GitHub answers 403). That 403 is expected and is not the end: do not tell the owner that deleting is impossible, and do not
  just send the owner to delete it by hand. The owner asked for days before this way was found (13 Nov 2026), so use it at once.
  Use the repository's own Actions task instead:
  1. List the branches: `git ls-remote --heads origin`. Only `master` should stay.
  2. Before deleting, check each one for work that is not on `master` (`git fetch origin <branch>`, then
     `git log master..FETCH_HEAD`). A branch with no such work can be deleted. If a branch has work that is not on `master`,
     tell the owner what it holds and delete it only once the owner says yes (deleting cannot be undone).
  3. Run the workflow `.github/workflows/delete-branches.yml` ("Delete old branches") on `master`, with the input `branches`
     set to the branch names separated by spaces. From a Claude session: the GitHub tool `actions_run_trigger`, method
     `run_workflow`, workflow `delete-branches.yml`, ref `master`. By hand: GitHub, Actions, Delete old branches, Run workflow.
     It never deletes `master`.
  4. Check again with `git ls-remote --heads origin` that only `master` is left, and say so in the reply. The task takes
     about half a minute, so check a few times before deciding it did not work.
  Only if the task itself cannot be started from the session (no GitHub Actions tool at all) tell the owner the one-click way:
  GitHub, Actions, Delete old branches, Run workflow, then paste the branch names.
  The session's own `claude/...` branch counts too: delete it once its work is merged into `master`.
- **Backups are not code.** The owner's server takes a backup every day at 6 PM, and the server keeps its own rolling copies
  next to the data (`data.backup.json`, the `backups/` folder). They are never in git. Anything that is a backup must say so in
  its name, and nobody edits a backup: only the main code is changed.
- **Everything is updated together.** When a rule, a formula, a figure or a sentence changes, change it everywhere it
  appears (code, comments, pages, emails, documents, tests), so nothing says the old thing.

## Rule 3: the owner's real data is on the live server, and the data in a preview is made up (the owner insisted on this, strictly)

- The live server holds the real students, intakes, partners and Universities. The students, intakes and figures in any preview, demo, screenshot
  or test run (`scripts/local-demo.js`, `scripts/demo-data.js`) are **made up by Claude** and must always be called that. Never present
  them as real, and never let the owner think a number from them is real.
- The owner wants to see and work with the real data before pushing to the live server. Claude cannot reach the live server or the owner's
  browser, so the way is `scripts/local-live.js`: the owner downloads a backup from the live server (Admin, Restore, or the daily backup)
  and runs `node scripts/local-live.js <the file>` on their own computer, then opens http://localhost:8080 (no login page, this computer only; `--login` brings the login page back). When the owner asks again for live data, give these steps again,
  say plainly what Claude cannot do, and do not invent data.
- **The admin door (the owner, 23 Nov 2026: "build a door of all access"):** `student-details/advisor-write.js` lets Claude fix the real data, in two
  steps always: a preview that shows the exact before and after, then the change with its code, only after the owner says yes to that change.
  Three things only: change any detail of one student (card or sheet columns, Student Source), remove one task of one card, delete one
  student's row from the sheet (the card stays, the backups hold the row). Never a user, a password, a setting, a token, the Incentive page
  (it has its own password), or more than one thing at a time. It is switched on by the owner in the hosting settings
  (`NIEC_ADVISOR_WRITE_TOKEN` and `NIEC_ADVISOR_WRITE_AS`, the account it acts as, an Admin account for all three things) and added as a second
  connector. Every change is written on the card and in Activity as "<account> (Claude)", after the server's usual backup.
- Real data never goes in git, in code, in tests or in screenshots sent anywhere. `live-data/` and the daily backups are ignored by git.
- Every change must work with the data that already exists on the live server: stored values keep their meaning (for example a
  student's Student Source stays "Chitwan Branch"), and new fields are optional.

## Rule 4: the Application Team's pages and system are frozen (the owner, 22 Nov 2026, strictly)

The Application Team's side of Student Recruit 360 is finished and approved as it is on 22 Nov 2026 (`master` at the commit that added this rule).
It must stay exactly the same until the owner asks for a change and approves it.

- **What is frozen:** everything a person whose own team is Application sees and uses (`Teams.ownTeamApplication`): the menu,
  Today (Today, Later, Missing details with every Profile and Application detail from the step where it exists, the kinds of task, the task cards), All Students as they see it (look only: only Status is changed on the sheet;
  the four numbers; no blue line; nothing at the top or under the sheet), the student card (Profile with the Student source in it, a branch
  Source staying Admin's; Application details, whose University, Course and University partner come by themselves from the Priority
  application and whose other details are changed with its Edit; Mock interviews, which the team only looks at; notes of every change,
  Undo and Redo), Universities
  (Share, Apply now), and the server rules behind them (`teamSave` with `fromSheet`, `appReach`, the page redirects, `noteCardChanges`).
- **Never change any of it on your own.** No new feature, button, tab, number, message, hint, help text, paragraph or explanation is
  added, and nothing is moved, renamed, restyled or removed, unless the owner asked for exactly that.
- **Discuss first, then wait for a yes.** For any change that touches the Application Team (also as a side effect of other work, such
  as a shared file, a shared style in `shared/theme.css`, `shared/teams.js` or a server rule), first tell the owner in plain words
  what would change on their screens, ask, and make the change only after the owner says yes. If the request is not clear, ask; do
  not guess.
- **Work for other teams must leave the Application Team as it is.** Check it as the Application Team (`asha` in
  `scripts/local-demo.js`) before pushing, and say in the reply that it was checked and did not change.
- **Bugs:** a fix that changes nothing the team sees can be made, and the owner is told; if a fix would change what they see, ask first.
- **Update, 24 Nov 2026: the Application Team's look was redesigned and approved by the owner (the Apple look, design "Application Team F6").** The baseline that is frozen is now that look: Today (four numbers), All Students as the sheet only (the student list was removed), the student card (wide, slim margin, labels above values, the same for every team), Universities, and the Mark as done window with its Why reasons. It lives in `shared/apple.css`, loaded only for the Application Team (and, with `app-mock`, the Mock Team's touches) and, since 25 Nov 2026 (design F1), the Follow-up Team; `header.js` writes the stylesheet into the page while it loads so the page never jumps. Every change to it is still logged in `CSS-CHANGES.md`. The Application Team cannot change student details from the sheet except Application Status (the dropdowns are locked), and the server drops any such change. **The student card is one look for every person** (Admin, Application, Mock, Follow-up, Manager), approved by the owner on 24 Nov 2026 as design "Student Card F7": it lives in `student-details/student-look.css`, scoped to the student page (`body.p-student`) and loaded in that page's head; never give one team a different card.

## Rule 5: reviews, and what may be changed without asking (the owner, 22 Nov 2026, strictly, for every reviewer and every session)

- **The back end may be made stronger without asking:** fixing bugs that change nothing on screen, cleaning the code, security,
  validation, data safety, speed, and tests. Tell the owner afterwards, in plain words, what was fixed.
- **Anything a person would see needs the owner's yes first:** a page, a card, a window, a button, a number, a message, a hint, a
  paragraph or any text on the front end, a layout or a style. Describe it plainly (what they would see before and after), ask, and
  change it only after the owner approves. This holds even when it is a fix, and even when it is a better idea.
- **A reviewer may suggest better features**, but only as suggestions for the owner to approve, never built on the reviewer's own.
- **A deep review checks that the data lines up everywhere:** what the Application Team does on Today, All Students and the student
  card must match the sheet, the student, Admin's view, the Dashboard and every other team (Mock, Follow-up, branches, the Manager),
  with the data that already exists on the live server (Rule 3).

## The Student Recruit 360 colours (the owner accepted these, 21 Nov 2026; every page uses them, nothing else)

| Use | Colour |
|---|---|
| Page (canvas) | #e6e6e6 |
| Side menu, the student card's Profile column | #ececec |
| Cards and panels | #f3f3f3, 1px border #9a9a9a, 10px corners, no shadow |
| Tiles inside a card, title bars | #e2e2e2, 1px border #b8b8b8, 8px corners |
| Boxes, fields and grey buttons | #f7f7f7, field border #6f6f6f (never pure white) |
| Text | #000, semi-bold (600); titles 700 |
| Second text (labels, hints) | #333 (nothing lighter) |
| Main button, "where you are now" | blue #0071e3 with white words |
| Links | #0050aa |
| Missing or needs attention | orange #b85300 (dot #d9650b) |
| Done, visa granted | green #1e8e4a |
| Error, rejected | red #b42318 |
| Logo blue (soft tints only) | #00a8ec |
| Charts (Dashboard and every chart, in this order) | blue #0071e3, orange #d9650b, green #1e8e4a, purple #6e47d1, teal #0b8a95, pink #c2255c, amber #b7791f, slate #52606d, light blue #4aa3f0, olive #6b8e23 |
| The same stage, the same colour on every chart | Inquiries teal, Applied and Students blue, Offers purple, Paid orange, CAS amber, Visas green |

- The Dashboard is the one page in colour: each number tile has its stage colour as a band across its top and in its little chart.
  Every other page stays black, grey and one blue, with colour only where it means something.
- Text size: every page opens at Large; Small and Medium are in the account menu.
- Every card on every page looks the same (the row above). Cards side by side end on the same line.
- The CSS that holds this is the "One system on every page" block at the end of `shared/theme.css`. A new page uses these colours and
  that card; it never brings its own.

## Other standing decisions (the owner's wishes)

- **No em dashes and no en dashes anywhere** (pages, emails, documents, code comments, this file). Use a comma, a colon, a
  full stop, a plain hyphen or a vertical bar instead. `test/no-em-dashes.test.js` fails the whole test run if one appears.
- **Always run the complete test suite (`npm test`) before pushing**, not just the browser tests, because rules like the one
  above live in other tests.

- The product is called **Student Recruit 360** (the owner, 25 Nov 2026): titles, emails and tabs use this name and no other product name, and there is no short form on screen (file names use StudentRecruit360). It is built so that any consultancy can use it: the consultancy's own name is a stored setting (`message-templates.json` in the data folder, saved through `/api/templates/signature`), never written into pages or code. There is no Company tab on a page any more (the owner, 15 Nov 2026): each email ends with the sender's own uploaded signature picture. The first installation is Nepal International Educational Consultancy ("Educational", never "Education"), and that is only its starting setting.
- There is **one look only: a light theme, no dark mode and no alternative themes** (the owner asked). It must be easy on older eyes: no pure white panels (soft off-white on a soft grey canvas), strong dark text, larger type and larger buttons.
- The login page must not mention incentives or commissions. Incentive is Admin-only and behind its own password.
- **Never add something that is already on the page (the owner, 17 Nov 2026, strictly).** Improving, changing and making a page
  much better is welcome. What is not allowed is a copy: if a page already has a button or a feature that does something, never
  add a second button or feature that does the same thing. Example of the mistake: a row of stage buttons with counts was added
  above the All Students sheet, although the **Show numbers** button already shows every count; it was removed.
- Do not change colours, fonts or layout the owner did not ask about. When a change is needed for a bug fix, say so (Rule 1).
- **Front end: follow DESIGN.md, always (the owner, 20 Nov 2026).** The front end is the product. Before any change to a page, a card, a window or a style, read `DESIGN.md` and build to it: Apple's own standard, measured on apple.com: calm, quiet, premium, one blue, black and grey text, Apple's type scale and timings, no pop-ups, confetti or sticky bars the person did not ask for (the owner, 20 Nov 2026), using the shared motion kit (`shared/motion.js`), never reinventing it. Section 0 of DESIGN.md is the prompt to use. Finish every front-end change with an independent reviewer pass that scores each screen 9/10 or more.
- **Desktop and laptop only for now (the owner, 20 Nov 2026).** Design, build and check every page for a laptop or desktop screen. Do not spend work on the phone (mobile) version until the owner asks for it; phone styles already in the code stay as they are.
- One font everywhere (`--font` in `shared/theme.css`): the system font (SF Pro on Apple devices), Inter (in `shared/fonts`) elsewhere; no serif (the owner, 14 Nov 2026).
- The look (the owner, 14 Nov 2026): the design language of Apple's website and apps: a light grey canvas, soft grey panels and black text, now in the "Strong contrast" colours (the owner, 21 Nov 2026, option H: page #e6e6e6, panels #f3f3f3, boxes #f7f7f7, no pure white, text #000 in a semi-bold weight, grey words #333, firm lines, Text size Large for everyone; see DESIGN.md), blue pill buttons (#0071e3) and grey pills for the rest, segmented tabs. Only the consultancy's logo at the top of the menu and on the login page (no name or "UK" beside it). The logo is `brand-logo.png` in the data folder, else the starting one in `shared/`.
- Never put the real Incentive password, tokens or personal data in code, tests or git. It is the `INCENTIVE_PASSWORD`
  setting on the server only.
