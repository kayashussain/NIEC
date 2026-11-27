# Going live: no data may be lost

**Read this before every upload to the live server.**

The owner reported on 27 November 2026 that some data goes missing when code is pushed to the live server.
The rule from now on: **an upload changes code only. Live data stays complete.** If any check below fails, stop.

The exact cause is **not yet confirmed**: the live server has not been examined for it. Write down each case in the
table at the end, so it can be traced.

This file holds no server paths or passwords. Folder names and upload steps are in `LIVE-SERVER.md` on the owner's computer.

## Where data can go missing

Found by reading the code on 27 November 2026.

| Risk | What happens | What prevents it |
|---|---|---|
| Typing during the restart | The page shows "Save failed. Retrying…". Closing or reloading it then loses the change. If someone else saves first after the restart, a page that is behind can be told "Not saved". | Everyone stops editing and sees "All changes saved" before the upload. |
| The data folder setting is lost | Without `STUDENT_DETAILS_DATA_DIR` the portal reads the code folder and would look empty. | The server now refuses to start (see below). Still check the counts. |
| New university details in the code | When the `version` in `student-details/fact-seed-partners.json` differs from the one last applied, each matching partner page takes the shipped details. A newer weekly reading is now kept. A university page nobody has edited is also rebuilt from the code. | Check step 3 below. |
| Tidy-ups that run at start | Code such as `partner-tidy.js`, `data-tidy.js` and the task-kind change rewrites or removes saved entries when the server starts. | Check step 3. Read the "automatic" entries in Activity afterwards. |
| An older build is uploaded | Older code may not keep newer details, and an older university version also counts as "different". | Name each ZIP after its commit and check it (step 4). Delete old ZIPs. |
| Local data expected on live | Data entered on the local or demo copy is never uploaded. This is on purpose. | Enter real data on the live portal only. |

An upload built as in step 4 holds no data files, and the data folder is outside the code folder.
Keep it that way.

## What the server does by itself

Added 27 November 2026 (`student-details/version-guard.js`), **not yet on the live server** (remove these words after
the first upload that carries it). The copy and the check work from that first start; the right-folder check works from the
start after it. It does not protect changes typed during a restart, so **still do every step below.**

- **Copy first.** When new code starts, every data file is copied to `version-backups/` in the data folder before
  anything is changed. The newest 10 copies are kept. If the copy cannot be made, the portal does not start
  (the app log says why). Free the disk space or fix the folder, then restart. `SR360_SKIP_VERSION_BACKUP=1` starts it
  without a copy: only with the owner's yes.
- **Check afterwards.** It compares the data with that copy at the start and again 15 minutes later, and writes in
  **Activity** either that the copy was made, or **Check the data** with the names of what disappeared or was emptied.
  The later check also lists anything people removed on purpose in those minutes.
- **Right folder.** It refuses to start on an empty data folder when the folder used before still holds the students
  (the folder is noted in `student-details/.data-folder` on the server). Delete that note only when the data was moved
  on purpose.
- **University pages.** A newer weekly reading on the live server is no longer replaced by older details in the code.

Uploaded files (agreements, guidelines, signatures) are not in these copies, because an upload does not change them.
The copies sit on the same server, so they do not replace the backups in step 2.

To get something back, take it from the copy made before that upload, with the owner's yes, after copying the data
folder as it is now. Putting a whole file back loses everything entered in it since the copy.

## Before the upload

1. Pick a quiet time. Ask everyone to finish, wait for **All changes saved**, and close the portal.
2. Back up, and keep both copies:
   - In the portal, as Admin: **Activity → Restore data → Back up now**. Write down the counts of students,
     Universities and Partner Universities, and also B2B partners, agents and open tasks.
   - In cPanel: compress the whole data folder **and** the Incentive data folder into a dated ZIP kept outside
     the code folder and outside the public web folder. The portal's backup leaves out accounts and uploaded files.
     The ZIP holds private data: never put it in git or in the project folder.
3. See whether the new code changes saved data at start (`LIVE` is the commit now on the server):

   ```powershell
   git diff LIVE HEAD --stat -- student-details/facts.js student-details/fact-seed-partners.json student-details/partner-tidy.js student-details/data-tidy.js student-details/workbook.js student-details/apply-through.js student-details/apply-through-seed.json student-details/server.js
   ```

   Read each change. If any of them rewrites or removes saved entries, tell the owner exactly what will change
   and wait for a yes.
4. Commit first (uncommitted work is not in the ZIP). Build only from the current folder, then check with
   `unzip -z` that the ZIP shows that commit, and with `unzip -l` that it holds no data files:

   ```powershell
   git -c core.autocrlf=false -c core.eol=lf archive --format=zip -o "isr-code-$(git rev-parse --short HEAD).zip" HEAD student-details shared counselor-incentive package.json
   ```

   Never zip the folder by hand: the local folder holds local data files.

## After the upload

1. Make sure no app process started before the upload is still running (ask the owner before stopping one).
2. Open `/niec/healthz`, then log in.
3. Compare every count with the ones written down. Open a few recently changed students, tasks and university pages.
4. Read the new **Activity** entries from "Student Recruit 360 (automatic)".

## Never

- Delete, move, rename or overwrite the live data folder.
- Upload data files, local or demo data, or the demo `users.json`.
- Press **Start fresh** as part of an upload.
- Upload an older build, except in an emergency the owner has approved.

## If something is missing

1. Stop, and ask people not to type anything.
2. Copy the whole data folder as it is now, before changing anything.
3. Check the data folder setting, then Activity, then files named `*.corrupt-*` or `*.damaged-*` in the data folder.
4. Compare with the backup made before the upload. **Restoring replaces the whole part chosen**, so anything
   added to it after that backup is lost. Ask the owner before restoring.

## Record

| Date | Commit uploaded | Counts before | Counts after | Anything missing (what, whose, when entered) |
|---|---|---|---|---|
| | | | | |
