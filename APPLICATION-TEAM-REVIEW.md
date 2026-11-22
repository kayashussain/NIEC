# Application Team back end: review of 22 Nov 2026

This file is the review record and the owner's question list. It is not a backup and not a second version of anything.

## What was reviewed

The server rules behind everything the Application Team uses: who can reach which student (`appReach`, `canSee`, `canChange`),
the sheet save (`teamSave` with `fromSheet`), the student card saves (profile, Application details, Student Source, University
options, notes), the stage moves (`MOVES`, `checkMove`), tasks (give, finish, reopen, hand on, remove), Missing details, the
Priority application sync (`syncApplicationDays`, `withPartner`), and the storage under them.

## Found and fixed (back end only, nothing on a screen changes)

| # | Problem | Effect | Fix |
|---|---|---|---|
| 1 | A card request read the student and the card **before** waiting for its body. Cards are replaced, not changed in place, so a second request that arrived meanwhile (a double press, two tabs, a retry) worked from an old copy. | "Mark as done" pressed three times at once was accepted three times: the answers were written again and Activity said it three times. | The card and student are read again after the body arrives, and a "done" or "not done" that is already the state is answered with OK and writes nothing. Test: `test/application-backend.test.js`, "the same task finished twice at once is written once" (fails without the fix, passes with it). |
| 2 | The same stale copy was used by every other card save (profile, Application details, Source, notes). | A "from → to" note could show an old "from" value when two saves crossed. | Same fix: every card save works from the student as it is when the body has been read. |
| 3 | (Earlier turn) The 6 PM backup and Restore did not hold the Mock interview guides or the Apply through choices. | Those would not come back after a lost file. | Added to backup and restore. |

## Checked and holding (with real requests to a real server, `test/application-backend.test.js`)

- A Payment Stage or Inquiry student is not found by the Application Team (404), also for a save.
- A Mock Stage student can be completed on the card (application columns) and the Mock columns stay the Mock Team's (403).
- A date that is not real, an offer before the application, a bad email, an empty name, a column that is not the team's: nothing is written.
- An object sent in a text field is stored as text, never as an object, and cut to the allowed length.
- Student Source: a listed source works, a made-up one is refused (400), a branch is refused for the team (403), and a branch student's source stays Admin's.
- Leaving Application for Mock needs University, Course, Application day and Offer day (refused without them), and then works.
- A forged sheet save cannot move or change a student the team does not have.
- Text typed on the sheet is dropped, never written (the card is where the team changes details).
- Every change on the card is written in the notes with the old and new value.

## Not checked, said plainly

- The screens (front end): not part of this review.
- Every combination of the Mock Team, Follow-up Team and branch workflows: only where they touch the Application Team.
- I cannot prove that no bug exists anywhere. What I can say: the rules above were tried with real requests and hold, one real
  bug was found and fixed, and all 382 tests pass.

## Questions for the owner: answered 22 Nov 2026

Q1: keep as it is (finishing writes the sheet and the notes, like the Medical step). Q2: add the lock. Q3: add the names to the message. All three are done; the questions are kept below for the record.

**Q1 (answered A, with a test: a Payment Stage student's Medical task still writes the sheet and the notes). A task for a student who has already moved on (for example to Payment Stage).** Today the Application Team can still open
that student while the task is open and for 7 days after it is done, and finishing the task can still write the answers to the sheet.
What should happen?

- A. Keep it as it is (recommended: a late task, such as an Offer request, still has to be finished and recorded).
- B. Let the team finish the task, but write only the note, never the sheet columns, once the student is past Application and Mock.
- C. Refuse to finish the task and show that the student has moved on.

**Q2 (done: lock added, `student-details/instance-lock.js`, test `test/instance-lock.test.js`). Two copies of the server running on the same data.** Nothing stops this today, and it would silently lose saves. The live setup
runs one copy, so the risk is low. A lock would refuse to start a second copy.

- A. Add the lock (recommended). If a second copy is ever started by mistake it refuses and says so, instead of losing saves.
- B. Add the lock, but only write a warning in the log and still start.
- C. Leave it as it is.

**Q3 (done: the message now names them). After a restore, the message names what came back.** The Restore message does not mention the Mock interview guides or the
Apply through choices, which now come back with "the B2B partners, the Dashboard records...". This is text people read.

- A. Add them to the message (recommended).
- B. Leave the message as it is.
