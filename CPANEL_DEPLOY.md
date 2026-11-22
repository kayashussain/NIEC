# Deploying to Nest Nepal (cPanel) with niec.duckdns.org

This is one of two supported ways to host the apps; the other is Render (`DEPLOY.md`). Pick one.

cPanel's "Setup Node.js App" runs the site as **one app**: Student Details, with the **Incentive** page
inside it at `/incentive` (Admin only, behind its own password). There is no separate Incentive app any more.

- `student-details` → `https://niec.duckdns.org/` (and `https://niec.duckdns.org/incentive/`)

## 1. Get the code onto the server

If your plan has **Terminal/SSH** (check cPanel for a "Terminal" icon):

```bash
cd ~
git clone https://github.com/kayashussain/uk-student-niec.git
```

That plain URL only works while the repo is **public**. No student data is ever in git, but if you'd
rather keep the code private, make the repo private on GitHub and clone with a read-only token
instead: create a fine-grained personal access token (GitHub → Settings → Developer settings) with
read access to just this repo, then
`git clone https://YOUR_GITHUB_USERNAME:YOUR_TOKEN@github.com/kayashussain/uk-student-niec.git`.
Treat the token like a password.

No terminal? Download the repo as a ZIP from GitHub (**Code → Download ZIP**) and upload
+ extract it into your home directory via cPanel's **File Manager** instead. Either way,
you should end up with `~/uk-student-niec/student-details` and
`~/uk-student-niec/counselor-incentive`.

Also create one more folder, outside both app folders, to hold the actual data so it
survives re-deploys:

```bash
mkdir -p ~/niec_data/student-details ~/niec_data/counselor-incentive
```

## 2. Create the first app: student-details

In cPanel → **Setup Node.js App** → **Create Application**:

| Field | Value |
|---|---|
| Node.js version | Latest available (18+) |
| Application mode | Production |
| Application root | `uk-student-niec/student-details` |
| Application URL | `niec.duckdns.org` (leave the path blank, this is the root) |
| Application startup file | `server.js` |

Click **Create**. Then scroll to **Environment Variables** on the same page and add:

| Name | Value |
|---|---|
| `STUDENT_DETAILS_DATA_DIR` | `/home/YOUR_CPANEL_USERNAME/niec_data/student-details` |

Click **Save**, then **Run NPM Install**, then **Restart**.

## 3. The Incentive page (no second app)

If you used to have a separate **counselor-incentive** app in cPanel, **delete that app** (Setup Node.js App → the app's
Delete button). Keep its **data folder** `~/niec_data/counselor-incentive`: your commissions and advances live there, and
the main app reads it from the same place. (`COUNSELOR_DATA_DIR` is only needed if the folder is anywhere else.)

Add this to the **student-details** app's Environment Variables, then **Restart**:

| Name | Value |
|---|---|
| `INCENTIVE_PASSWORD` | the password Admin types to open Incentive |

How Incentive works now:

- Only the **Admin** account can open it (click your name at the bottom of the menu → **Incentive**). Nobody else can, whatever they know.
- Admin types **only that password** (no username). It is asked **every time**: going to any other page (Student Details,
  Dashboard ...), reloading Incentive or closing it locks it again, and an Incentive page left untouched for 20 minutes
  locks itself. Five wrong tries in a row make the person wait 15 minutes. Changing `INCENTIVE_PASSWORD` and restarting
  locks it again everywhere.
- If `INCENTIVE_PASSWORD` is not set, Incentive stays locked and says so. The password is never in the code or in git.
- The old address `/commission` forwards to `/incentive/`.
- The **Claude connector** (`/advisor-mcp/<token>`) reads the same data folder directly with its own secret address,
  so it never asks for this password. It is unchanged.

Everyone has **their own account**; there are no shared logins. Logging in takes the person's
password (at least 10 characters), with no second step (no authenticator app or codes). A login lasts 12 hours, and
wrong passwords lock the account for 15 minutes.

- **First start:** while there are no accounts, the server makes a one-time **setup code**, prints it
  in the app's log and saves it in `first-admin-code.txt` in the Student Details data folder. The
  login page asks for it to create the first Admin account; you then choose your own password and the code is deleted. Do this straight after deploying.
- **Intakes:** Admin and the Manager see every intake sheet. The Application Team and the branches see only the newest sheet, so when you start a new intake the earlier one leaves their screens by itself. There is no sheet password.
- **Adding people:** Admin → **Users** → *Add a person*: name, username (not case sensitive), email, and
  what they can do. Tick any mix of Application, Chitwan Branch, Pokhara Branch, Palpa Branch, Butwal Branch and Manager (the Mock and Follow-up Teams were removed, 22 Nov 2026) (a Manager who also ticks a team can change that team's students in the current intake). They are emailed a link and a temporary
  password (see **Email** below); at their first login they choose their own password and link their
  phone. Admin is the owner account: nobody else can ever be made Admin.
- **When someone leaves:** Users → **Remove**. Their login is deleted and they're logged out of every device at once; they can't
  log in again. **Disable** pauses a login without deleting it.
- **Forgotten password:** Admin uses *Reset password* (the new
  temporary password is emailed to the person).
  If no Admin can log in, run on the server
  `STUDENT_DETAILS_DATA_DIR=<the data folder> node scripts/reset-login.js <username>`.

The accounts (`users.json`, passwords stored only as salted scrypt hashes), logged-in devices
(`sessions.json`) and settings live in the Student Details data folder, never in git and never
served. Every login, failed login, logout and change is recorded in `activity.jsonl` there; Admin sees
it on the **Activity** page, which can be filtered by person, type, dates and words. After 20 wrong tries from one address, or 8 for one account, within 15
minutes, further tries are refused until the 15 minutes are up. No environment variables are needed.

**What each account sees** (rules in `shared/teams.js`, enforced by the server; the server only ever
sends an account its own students). A person can work in **several teams at once**: they get the
students, columns and moves of every team they hold.

| Account | Sees | Can change |
|---|---|---|
| Admin (the owner) | everything, all pages | everything |
| Manager | the **Dashboard** and every student on every sheet, earlier intakes too, view only | nothing; can use Export Excel; no Incentive page |
| Application Team | students at *Application Stage*, in the newest intake only | columns up to NOC Number; can move a student to *Mock Stage* (warned about anything still blank); moving on from *Mock Stage* is Admin's |
| Each branch (Chitwan, Pokhara, Palpa, Butwal) | the students whose *Student Source* is that branch, at any stage (current intake) | every column of those students, any stage move; can add students (tagged with the branch) |

**Partner pages** (rules in `student-details/partner-access.js`; the server strips what an account may
not see before sending anything): Admin sees and changes everything. The **Manager** looks at Partner Universities, B2B Partners
and Agents **with the commission** (no portal login), and at Events and marketing. The **Application Team** works from Today, All Students and Universities
instead (the owner, 21 Nov 2026); **Apply now** on a university shows it how to apply. **Branches** look at Partner Universities
the same way (without the commission: no commission slabs, payment terms, commission lists, agreement files, notes or portal
login). A **branch** can give a task about its own student to the Application Team or Admin (Assign a task on the student card), sees on Today
whether it is done, talks it through in the task's comments, and removes only the tasks it gave.

Every team can add a new student with **+ Add student**: it starts at the team's own stage (Application Stage
for the Application Team, Inquiry for a branch), and the team can also fill in its name, email, contact number and student
source (on students it added itself). Deleting students and sheets, and the
Incentive page, are Admin only. Export Excel is for Admin and the Manager.

The Incentive page uses the same accounts and login as the rest of the site (it runs inside the same app). `APP_USERNAME`,
`APP_PASSWORD` and `REQUIRE_PASSWORD` are no longer used; you can delete them.

## Email (setup details for new people)

Email is set up on the server, not on a web page. Run these in the project folder (use the same
`STUDENT_DETAILS_DATA_DIR` as the app if you set one):

```
node scripts/email.js setup
node scripts/email.js test someone@example.com
```

`setup` asks for the mailbox (for example `name@yourcompany.com`) and its password, and saves them in
`mail.json` in the Student Details data folder (never in git, never served, private to the server user).
`setup` also asks for the mail server (it suggests `mail.` plus the mailbox's domain, for example `mail.yourcompany.com`); the port defaults to 465 with SSL, change it when asked (587 means
STARTTLS). `test` sends a message and says what went wrong if it fails. From then on, adding a person (or
resetting a password) emails them their link, username and temporary password. If email is not set up, or a
message cannot be sent, the temporary password is shown to Admin instead so it can be given in person.
The web server must be allowed to reach the mail server on that port. You can also use the environment
variables `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURITY`, `MAIL_USER`, `MAIL_PASSWORD`, `MAIL_FROM`,
`MAIL_FROM_NAME` and `SITE_URL` instead of the file.

**A Gmail address as the office mailbox (the owner, 22 Nov 2026: the team and the students use Gmail).** No company email is
needed. The new-person emails and Admin's emails go from this one mailbox.

1. In that Google account: turn on 2-Step Verification, then make an **App password** (Google Account, Security, App passwords).
   Google gives 16 letters; that is the password Vishnu uses (never the normal Gmail password).
2. On the server, in the project folder: `node scripts/email.js setup`. Mailbox: the Gmail address. Password: the 16-letter app
   password. Mail server: `smtp.gmail.com`, port `465`, SSL.
3. `node scripts/email.js test` followed by your own address, and check the message arrives.
4. Set **`SITE_URL`** to the site's own address (for example `https://isr.example.com`) in the app's environment variables (or
   answer it in `setup`), then Restart. Links in emails always use this address.

## Universities

Every account has a **Universities** page: a list of universities, and for each one a page with its entry
requirements, language test, courses, location, intakes (with their own requirements and courses) and the
application process step by step. Anyone can read it and use **Print or save as PDF** to get a clean A4
copy. Only Admin can add, edit or delete a university. It is stored in `fact-file.json` in the Student
Details data folder (never in git; back it up with the rest of the data folder).

## Dashboard

Each branch has its own **Dashboard** of its work (see README, My dashboard). Admin and the Manager have a **Dashboard** made for planning intakes: the student journey from inquiry to
visa with the share that goes on at each step, money (deposits received, still to collect, average fee),
visa success, a forecast of visas, payments and deposits still to come, how many days each step takes,
every intake side by side, month by month trends, who needs chasing, and breakdowns by source, university
partner, university and course. A step is counted from its own date or from any later stage (a student at
Visa Issued has applied, had an offer and paid), and a note under the page says how many were counted that
way. It can be filtered by intake and updates itself every 30 seconds.

Optional: `APP_TIMEZONE` (default `Asia/Kathmandu`) sets which calendar day daily
backups and "today's" exchange rate follow.

After 20 wrong passwords from one address within 15 minutes, that address is locked out for the
rest of the 15 minutes. This relies on the host passing the visitor's address in
`X-Forwarded-For`; if it doesn't, a lockout applies to everyone at once until it runs out.

(Replace `YOUR_CPANEL_USERNAME` with your actual cPanel username, visible at the top of
the Node.js App screen or in "Application root" once created, cPanel shows the full
absolute path there.)

## 4. Seed your existing data

Copy your current `student-details/data.json` into `~/niec_data/student-details` (cPanel **File Manager** → Upload) **before the app's first start**
(or stop the app, copy it, and start it again). The app reads it from there. (Uploading through the
site isn't possible any more, since uploads need a login.)

## 5. Check it

- `https://niec.duckdns.org/` should show the login page, then the tracker
- `https://niec.duckdns.org/incentive/` should (as Admin) ask for the Incentive password, then show the incentive page

## Student cards, messages, B2B Partners and the decision pages

New in the same app, no new setup needed: the data goes in new files of the Student Details data folder (`cards.json`, `message-log.jsonl`, `message-templates.json`, `course-links.json`, `b2b-partners.json` with `b2b-files/`, `planning.json`), never in git. They are in the 6 p.m. backup (restore them from Activity, Restore data) and the first save of each day also copies them into `backups/`.

- **Email to students** goes from **each person's own mailbox** (the owner, 14 Nov 2026). A mailbox set up earlier on Follow-up, Your setup for sending, keeps working (the Follow-up page was removed, 22 Nov 2026). The password is kept encrypted in `user-mail.json` with its key in `mail-key`, both in the Student Details data folder, never in git, never in the daily backups, never shown on a page. A team member without their own mailbox cannot email (Send email keeps a preview). Admin sends from their own mailbox if set, else from the office mailbox (`node scripts/email.js setup`, see Email above). A team member's email is signed with their name, team, address and phone; a copy goes to their own mailbox and to the office mailbox.
- **WhatsApp on your phone**: nothing to set up on the server. Each person connects their phone once: on the computer, the menu (their name), **Connect my phone** shows a code; they point the phone's camera at it and tap **Turn on** (an iPhone shows one extra step, Add to Home Screen). Then WhatsApp on the computer sends a notification to that phone, and one tap opens the student's chat there. The site must be on https (it is). The server makes its own key the first time (`push-keys.json` in the data folder); deleting that file disconnects every phone. A phone connected before 17 Nov 2026 should be connected once more (Disconnect, then Connect my phone): from then on it keeps itself connected.
- **The university finder needs nothing set up:** it runs inside the server and reads the entry rules in Universities. No key, no outside service.

New files of the same kind since then: `agents.json` with `agent-files/` (the Agents page), `source-options.json` (choices added to "Where exactly") and `course-watch.json` (the weekly check of the course pages; set `COURSE_WATCH=off` to switch it off). A file the server could not read is never deleted: it is set aside as `<name>.damaged-<time>.json` next to the data.

## The Thursday refresh of partner universities

Every Thursday from 2 a.m. office time, Vishnu reads the January 2027 courses, requirements and dates of each partner university again
from the partner it came from, with the login saved on that partner's B2B card (Partners, B2B Partners): Real Dreams through the
Route2Uni portal, Adventus through its course search. Apply Board is not read (its sign-in asks a person to prove they are not a
robot). Every run is written in Activity. Nothing needs setting up. To switch it off, add `PARTNER_REFRESH` with the value `off` to
the app's Environment variables, then Restart. The old `ROUTE2UNI_EMAIL` and `ROUTE2UNI_PASSWORD` variables are not used: delete them
if they are still there.

## The Navitas product toolkit in Universities

Vishnu reads the Navitas product toolkit (the public Google Sheet "Nepal UK/Europe Navitas product toolkit") twice a week, Monday and
Thursday from 2 a.m. office time, and gives each UK Navitas college its own university page: fees,
scholarships, entry requirements, English, study gap, courses, the January intake with its deadlines and courses, interview
questions, Flywire payment and refund links, accommodation and the application steps. German and Dutch colleges are left out,
and so is Manchester Metropolitan University International College (closed). Nothing needs to be set up: the sheet must stay shared
as "Anyone with the link can view". The first reading is three minutes after a Restart; after that it runs by itself (there is no
button to start it).

- To read another copy of the toolkit, add the variable `NAVITAS_SHEET_ID` = the long id in the sheet's link (between `/d/` and
  `/edit`), then Restart.
- To switch it off, add `NAVITAS_TOOLKIT` = `off` and Restart (the pages keep what they have).
- Every part of these pages follows the sheet. Nobody edits a university page; the team may only correct an intake's dates (Change
  dates), which are kept until the sheet itself changes them.

## Updating the code later

Use these commands, not `git pull`. The code on GitHub is sometimes rebuilt from the start (as on 14 Nov 2026), and `git pull`
then stops with "refusing to merge unrelated histories". These commands always make the server's code exactly the code on
`master`. They only change files that are in git: the data (in `~/niec_data`, or the data files next to the code if no data
folder is set) is never touched, because it is not in git.

1. First keep a copy of the data, named as a backup (it is never in git):

```bash
cp -a ~/niec_data ~/niec_data.backup-$(date +%Y-%m-%d)
```

   (If the app has no `STUDENT_DETAILS_DATA_DIR`, the data is in `~/uk-student-niec/student-details` instead: copy the whole
   folder with `cp -a ~/uk-student-niec ~/uk-student-niec.backup-$(date +%Y-%m-%d)`.)

2. Get the code:

```bash
cd ~/uk-student-niec && git fetch origin master && git reset --hard origin/master && git log -1 --oneline
```

3. In cPanel's Node.js App screen, hit **Restart** on the app (and **Run NPM Install** again if `package.json` changed).

4. Open the site and log in. Everyone stays logged in, and every student, intake, Universities entry, partner and incentive
   figure is as it was. Never run `git clean`: it would delete the data files that are not in git.

To go back to the code before an update: `git reset --hard <the commit shown by git log -1 before the update>`, then Restart.
The older code still reads the data the newer code has written.
