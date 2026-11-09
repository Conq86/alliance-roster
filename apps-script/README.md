# Alliance submissions & approvals — Apps Script backend

Two small Google Apps Script projects power the Submit tab. No paid hosting, no
new accounts, no recurring charges. Everything runs on the owner's Google account.

| Project | Folder here | Web app access | What it does |
| --- | --- | --- | --- |
| Submissions | `submissions/` | Execute as: Me · Who has access: **Anyone** | Accepts anonymous submissions, validates them server-side, stores originals in a private Drive folder + a tracking Sheet. Never publishes, never lists submissions. |
| Admin | `admin/` | Execute as: Me · Who has access: **Only myself** | Private approval screen: preview, correct titles/names, approve (publishes to GitHub), reject, unpublish, daily YouTube channel sync. Google-account sign-in is the authentication, plus an owner-email check in every function. |

The two projects share one Drive folder and one Sheet. The GitHub token lives only
in the Admin project's Script Properties — never in this repo, never in the browser.

## Deploy (owner, one time, ~15 minutes)

1. **Admin project first.** Go to <https://script.google.com> → New project. Name it
   `POW 713 Admin`. Replace `Code.gs` with `admin/Code.gs`, then add `admin/Admin.html`
   (Files → + → HTML, name it `Admin`, paste the file).
2. **Create the storage.** In the Admin editor, run `setupDrive()` once (or deploy first
   and use the Setup button on the admin screen). It creates a private
   `POW 713 Submissions (private)` Drive folder and a `POW 713 Submissions` Sheet, and
   stores their IDs in this project's Script Properties. Copy the two IDs.
3. **Submissions project.** New project named `POW 713 Submissions`. Replace `Code.gs`
   with `submissions/Code.gs`. Open Project Settings → Script Properties and add:
   `DRIVE_FOLDER_ID` and `SHEET_ID` (the two IDs from step 2).
4. **Deploy the Submissions web app.** Deploy → New deployment → Web app.
   Execute as: **Me**. Who has access: **Anyone**. Copy the `/exec` URL.
5. **Connect the website.** Paste that URL into `submit.js` as `SUBMIT_ENDPOINT` and
   commit to `main`. Until then the Submit tab shows "Submissions are not open yet"
   and the form stays disabled — by design.
6. **Deploy the Admin web app.** Deploy → New deployment → Web app.
   Execute as: **Me**. Who has access: **Only myself**. Bookmark the `/exec` URL —
   that is the private approval link. Only the owner's Google account can open it.
7. **Admin settings.** Open the approval link → Settings, and add:
   - **GitHub token** — a fine-grained personal access token for `Conq86/alliance-roster`
     with **Contents: Read and write** only. (GitHub → Settings → Developer settings →
     Personal access tokens → Fine-grained tokens.) It is stored server-side and is
     never shown again.
   - **YouTube API key** (optional, recommended) — switches channel sync to the official
     YouTube Data API, fills in publish dates and durations for approved video links, and
     enables the optional playlist sync. Create it in Google Cloud Console (APIs & Services →
     enable **YouTube Data API v3** → Credentials → Create credentials → API key). Restrict it:
     **API restrictions → Restrict key → YouTube Data API v3** only. Leave application
     restrictions at None — Apps Script calls come from Google servers with no fixed IP or
     referrer, so IP/website restrictions would block it. Paste it only into this private
     Admin screen: it is checked against the configured channels before saving (a failed
     check keeps the previous key), stored in the Admin project's Script Properties, sent
     only in the `X-goog-api-key` header, and never returned to the browser, logged or put in
     the repo. Public data only — no OAuth or billing needed; daily sync uses a few quota
     units of the free 10,000/day.
   - **Playlists** (optional, needs the API key) — JSON array of extra playlists, e.g.
     `[{"playlistId":"PL…","creatorId":"med","creator":"MED","member":"med","channel":"MED LAST Z","channelUrl":"https://www.youtube.com/@med.713"}]`.
   - **Storage safety limit** — default 900 MB. Publishing refuses above it (Pages
     limit is 1 GB; the site is ~280 MB now).
8. **Daily sync.** On the approval screen, "Enable daily sync (9 AM)" (creates one daily
   trigger, around 9 AM in the Apps Script project's time zone; pressing it again
   replaces it). "Sync now" runs it immediately.

## How it works

- **Submit:** the form posts through a hidden iframe (Apps Script web apps don't
  send the CORS headers a `fetch()` call would need). The script answers with a tiny
  page that `postMessage`s `{ok, id}` back to the site. The site shows
  "Submitted — awaiting approval" only after that answer, which the server sends
  only after the Drive save and Sheet row both succeed. Retries are safe: the same
  file (SHA-256) or the same YouTube ID returns the existing submission ID instead
  of creating a duplicate.
- **Validation (server-side):** type must be music / fanart / youtube; game name ≤ 40
  chars, title ≤ 120, description ≤ 500; music must be MP3 or M4A, fan art PNG/JPG/WebP,
  ≤ 25 MB, and magic bytes must match the extension; YouTube links must parse to an
  11-character video ID. Honeypot field + daily caps (50/day total, 10/day per name)
  are the spam protection — Apps Script does not expose the visitor's IP, so IP
  limiting is not possible here.
- **Approve:** the Admin script checks the site size first (refuses over the safety
  limit), copies the original from private Drive into the repo (`media/<creator>/` for
  songs, `fanart/` for artwork), updates `media.json` / `fanart.json` (new creators get
  their own playlist/group automatically), and records the commit in the Sheet.
  Approval is idempotent: approving twice returns the first result. The screen says
  "approved — publishing"; **Check live** fetches the published URL and confirms
  the file is actually serving, which is what distinguishes approval from deployment.
- **YouTube links:** approval lists the video in `media.json` (deduplicated by video ID).
  Format is `short` only when the submitted URL was a `/shorts/` link; publish date and
  duration are filled in from the YouTube API when a key is configured.
- **Channel sync, official API mode** (API key saved): once daily (or "Sync now")
  `channels.list` returns each channel's uploads playlist, `playlistItems.list` reads every
  page of it, and `videos.list` (batches of 50) gives each new ID's real title, owning
  channel, publish date (`publishedAt`) and length. POW Ruthless: all uploads; MED: published
  on or after 2026-10-10. Videos owned by another channel, live/upcoming or unavailable ones
  are skipped. The API can't reliably identify Shorts, so new entries are `format: "video"`;
  existing formats are kept. Nothing is scraped in this mode; an API error stops the sync
  with a short message (no key or URL) and nothing is written.
- **Channel sync, public mode** (no API key): once daily (or "Sync now") the script reads the public Videos and
  Shorts tabs (first page, up to 50 each) of the owner-trusted channels — MED
  (`UCJRuTu8UfGlM40IjvAc4N9Q`, uploads from 2026-10-10 on) and POW Ruthless
  (`UC-AlzeeDBHbfnrjjlpC-Gng`) by default, or the `CHANNELS` Script Property if set
  (`[{channelId, creatorId, since?}]`). No API key; YouTube's RSS feed returns 404 for
  these channels. Each new video ID's own watch page gives the upload date, length and
  owning channel; videos without a readable date, or owned by another channel, are
  skipped and retried next run. New entries go into the creator's existing
  `media.json` group (marked `channelSync: true`), newest first. Existing entries are
  never changed, reordered, duplicated or removed. If a channel's tabs yield no usable
  uploads, the sync fails with an error and nothing is written. Sync shares the
  approval lock, and the last result shows on the approval screen. These two channels
  publish without approval by owner decision; every other submission still needs it.
- **Playlist sync (optional):** with an API key, configured playlists are synced the
  same way in the same run.
- **Unpublish:** removes the listing from `media.json` / `fanart.json` and deletes the
  published file from the repo. The private original stays in Drive and the Sheet row
  is kept for history.

## Limits to know

- GitHub rejects files over 100 MB; the form caps at 25 MB. Large videos should be
  YouTube links, not file uploads.
- Apps Script URL fetch calls are capped (20,000/day) — far above this site's needs.
- M4A playback is supported by the site's player (native browser AAC), but has not
  been verified with a real M4A file yet — the first approved M4A should be played
  on the owner's phone before relying on it.
- If the Submissions deployment is ever redeployed, paste the new `/exec` URL into
  `submit.js` again; the Admin URL stays the same across its own redeployments only
  if the same deployment is updated (Deploy → Manage deployments → edit).
