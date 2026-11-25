# Student Recruit 360 system roadmap (22 Nov 2026)

What makes a portal like this "top global brand" level, what is done, and what is next. Each step that changes how data is stored
needs the owner's approval first.

## Done
- Saves written whole or not at all; rolling backup, daily copies, 6 p.m. copies, recovery from a damaged file.
- Backups hold every kind of data people edit (students, cards, Universities, partners, records, Mock bookings, guidelines, guides, Apply through).
- One server per data folder (a second copy refuses to start).
- Off-site encrypted backup to any S3-compatible store (needs the owner's bucket and passphrase, see `shared/` and the server settings).
- Backup problems written in Activity; Admin can check the off-site state; `/healthz` for an uptime monitor.
- A request is worked out from the data as it is when it arrives (a double press writes once).
- 380+ automated tests, including real-server tests of every team's rules.

## Database plan: progress
- **Step (a), in progress:** `student-details/store.js` is the one door to stored data, with two backends (JSON files, as today; SQLite)
  that must pass the same `test/store-contract.test.js`. The student cards already read and write through it, with every old test
  passing, and the real cards module is tested on SQLite too (same answers as files). Still to move onto the door: the students sheet
  (`data.json`), planning, B2B, messages, bookings, guides and the other small files.
- **Not switched on:** the live server still uses files. `node:sqlite` needs Node 22.5 or newer; the cPanel notes say "18+", so the
  Node version of the live host must be checked first (or a SQLite package added).

## Next, in this order
1. **Owner: set the off-site settings** on the live server and an uptime monitor (about 15 minutes). Until then there is no copy outside the server.
2. **Database (SQLite first, PostgreSQL later).** Today the data is JSON files held in memory and rewritten whole on each save. That is safe
   and fast for thousands of students; a database gives per-record saves, history of every change, and room for many branches and
   years of data. Plan: (a) put the storage behind one small interface, with the current files as the first implementation and every
   test still passing; (b) add the SQLite implementation and a one-command migration that copies the real data and compares it
   student by student; (c) run both side by side on the owner's computer with `scripts/local-live.js` and a real backup; (d) switch the
   live server only when the owner has seen the real data match. Never a big-bang change.
3. **Split the very large files** (`portal-api.js`, `app.js`) into smaller pieces, with the tests as the safety net, no change on screen.
4. **Failure alerts by email to Admin** (backup failed, off-site failed, disk nearly full).
5. **A standby server** (a second machine ready to take over) once the database is in; two live copies on files would lose saves.
