# Switching on the off-site backup

**Why:** today every backup of Student Recruit 360 sits on the same cPanel server as the portal. If that server, its disk or the
hosting account is lost, the backups go with it. The off-site backup sends an encrypted copy of every backup to a storage bucket
somewhere else. It is already built into the portal; it only needs a bucket and five settings. About 15 to 20 minutes.

This file holds no keys or passwords. Never write them in git, in this file or in a chat.

## What leaves the server

- Every daily (6 p.m.), manual ("Back up now") and "before restore" backup: students, student cards and tasks, Universities,
  Partner Universities, B2B partners, agents, Dashboard records and events, message settings, Mock bookings, interview guidelines
  list, Apply through, and the Incentive figures.
- Each file is encrypted on the server with your passphrase before it is sent. The storage company sees only scrambled data.

**Not in it:** user accounts and their passwords, uploaded files (agreements, interview guideline files, signatures) and the key file
`mail-key`. After losing the whole server, people's logins are made again on Users, and the mailbox and partner portal passwords are
typed again. Keep doing the monthly ZIP of the whole data folder from GO-LIVE-DATA-SAFETY.md (step 2) on your own computer.

## 1. Make a bucket (Cloudflare R2, the example here)

Any S3-compatible store works (Cloudflare R2, Backblaze B2, Amazon S3, Wasabi). R2 has a free allowance that is far more than
these backups need.

1. Sign in to Cloudflare (or make a free account), open **R2 Object Storage**.
2. **Create bucket**. Name: for example `sr360-backups`. Location: Automatic.
3. **Manage R2 API Tokens** (or **API** › **Manage API tokens**) › **Create API token**:
   - Permissions: **Object Read & Write**
   - Apply to: **only the bucket** you just made
   - Create it, then copy the **Access Key ID** and the **Secret Access Key**. They are shown once.
4. Note the **S3 endpoint**, shown with the token or on the bucket's settings page:
   `https://<your account id>.r2.cloudflarestorage.com`

(Backblaze B2: make a private bucket, then **Application Keys** › **Add a New Application Key** for that bucket only. The keyID is the
access key, the applicationKey is the secret key, the endpoint is `https://s3.<region>.backblazeb2.com`, and the region is the
`<region>` part, for example `us-west-004`.)

## 2. Make a passphrase and keep it safe

The passphrase encrypts every copy. **Without it nobody can open a backup, not even you.** Make one on any computer with Node:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep it in two places away from the server, for example a password manager and a printed copy in the office safe.

## 3. Put the settings on the server (cPanel)

cPanel › **Setup Node.js App** › the Student Recruit 360 app › **Edit** › **Environment variables** › add each one:

| Name | Value |
|---|---|
| `NIEC_OFFSITE_ENDPOINT` | the S3 endpoint from step 1, e.g. `https://<account id>.r2.cloudflarestorage.com` |
| `NIEC_OFFSITE_BUCKET` | the bucket name, e.g. `sr360-backups` |
| `NIEC_OFFSITE_REGION` | `auto` for R2 (Backblaze: its region; Amazon: e.g. `eu-west-2`) |
| `NIEC_OFFSITE_ACCESS_KEY` | the Access Key ID |
| `NIEC_OFFSITE_SECRET_KEY` | the Secret Access Key |
| `NIEC_OFFSITE_PASSPHRASE` | the passphrase from step 2 |
| `NIEC_OFFSITE_PREFIX` | optional: a folder inside the bucket (default `sr360-backups`) |

**Save**, then **Restart** the app at a quiet time (everyone sees "All changes saved" first).

## 4. Check that it works

1. Log in as Admin › **Activity** › **Restore data**. The **Off-site copy** box says **On, to the bucket ...**.
2. Press **Test off-site backup**. It writes one small test file to the bucket, then sends every backup not sent yet. It says
   **It works** or what went wrong. The test is written in Activity.
3. In Cloudflare, open the bucket: files named `niec-daily-....json.gz.enc` are there.

From then on every new backup is sent within a few minutes of being made. If sending fails, Activity gets a **Backup problem**
line and the portal tries again every five minutes. While the off-site backup is off, Admin's Today shows a reminder once a day.

## 5. Getting data back from an off-site copy

1. Download the `.json.gz.enc` file you need from the bucket.
2. On a computer with this code:
   ```bash
   NIEC_OFFSITE_PASSPHRASE='<the passphrase>' node scripts/decrypt-backup.js niec-daily-2026-12-01.json.gz.enc
   ```
   It writes `niec-daily-2026-12-01.json.gz`, the same file the server keeps.
3. To look at it on that computer: `node scripts/local-live.js niec-daily-2026-12-01.json.gz`.
4. To restore it on the server: copy the `.json.gz` into the data folder's `daily-backups/`, then Admin › Activity › Restore data ›
   Restore (each part on its own; today's data is saved first). Ask the owner first, as GO-LIVE-DATA-SAFETY.md says.

## Switching it off

Remove `NIEC_OFFSITE_PASSPHRASE` (or any of the settings) and restart. Nothing more is sent; what is in the bucket stays there.
