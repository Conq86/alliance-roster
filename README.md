# alliance-roster

Alliance character roster: full-body character art for all ~100 members, plus the showcase page and the members' Music & Videos hub.

## Layout
- `characters/` — one file per member, named after the member (e.g. `characters/scatcat.png`). Every edit is a new commit, so the full revision history of each character is kept here.
- `badges/` — original member-created PNG badges. Use the same filename as the member's character: `badges/scatcat.png`, `badges/lion.png` for ŁIØN, `badges/baqian.png` for 仈仟, or `badges/ace-yen.png` for Ace ¥.
- `index.html` — a shared 3D carousel with **Characters** and **Badges** tabs. Both use the same rotating wheel, member directory, search, hover pause, and name-jump controls. Direct-link to badges with `?view=badges`. A third **Music & Videos** tab (`?view=media`) replaces the wheel and directory while it is open; the wheel pauses and resumes where it left off. **Fan Art** (`?view=fanart`), **Guides** (`?view=guides`) and **Submit** (`?view=submit`) tabs work the same way. Switching between these hub tabs hides the previous one (and stops any playing media).
- `media.json` and `media/`: the Music & Videos list and the approved member MP3/M4A/MP4 files it points to (see below). `media.js` renders it.
- `fanart.json` and `fanart/`: the approved fan art list and files. `fanart.js` renders the gallery.
- `guides.json`, `guides.js` and `guides/`: the Season Guides tab (tips and walkthroughs per season) and its downloadable decks.
- `submit.js`: the member submission form (posts to the Apps Script backend; see Submissions & approvals).
- `apps-script/`: the Google Apps Script backend — public submissions endpoint + private owner approval screen. See `apps-script/README.md` for deployment.

## Uploading badges
1. Find the member's exact name and filename in `ROSTER.md`. Upload the approved original PNG to `badges/` with that filename, preserving the image bytes and artist credit. Do not regenerate or recompress it.
2. For someone without a completed character, add one row to **Badge-first members** in `ROSTER.md`: the exact game name and `badges/<confirmed-filename>.png`. Confirm unusual handles instead of guessing. Use lowercase ASCII letters, numbers, hyphens or underscores in filenames. The exact game name stays in the Member column.
3. Commit the upload (and any new roster row) to `main`. After Pages succeeds, reload `?view=badges`. No webpage or JSON edits are needed. Select a member and use **View full badge** to open their original artwork.

Missing badges display a dark **BADGE COMING SOON** placeholder. The first badge batch is complete: the source folder held 63 original PNGs, imported byte-for-byte as 62 member badges plus one general alliance badge. Registered members total 76 (48 character members and 28 badge-first members); 14 existing character members have no badge supplied yet and show the placeholder. The general POW 713 alliance badge is not a member and is not listed in the roster: [badges/alliance-pow-713.png](badges/alliance-pow-713.png). Characters only lists members with an uploaded character; Badges lists all registered members, including those whose character is unfinished.

`ROSTER.md` is the single roster authority. `gallery-data.json` is a Jekyll template, generated automatically from its Member/File tables and the files in `characters/` and `badges/`. Do not maintain a separate member list in that template. `gallery.js` renders both views through the same wheel and directory. The existing static cards provide a fallback if the roster request fails.

When a badge-first member's character is completed, upload `characters/<same-filename>.png` and move their row to the Committed table, preserving their game name. Keep the existing committed order; the filename identifies the same person across both galleries. Never reuse one filename for different members. Existing search aliases for unusual handles are preserved.

Pages must continue to build with Jekyll from `main` at `/`; do not add `.nojekyll`. The roster JSON is generated at deployment, so uploads become available after the next successful Pages build.

## Music & Videos
The third tab (`?view=media`) has **Music** and **Videos** sections. Everything in it comes from `media.json`; adding a creator, track or video is a manifest edit only. No layout, HTML, CSS or JS changes.

- **Music**: one playlist per creator. DaWG and KelGris (Kels) playlists exist and are empty until their approved files arrive. The page uses one native audio player with Previous/Next and a track list. Selecting a playlist cues its first track without downloading it (`preload="none"`). Playback starts only when someone presses play or picks a track. After that, the next track in the same playlist plays when one ends. If the browser blocks playback, the player says "Press play to start".
- **Videos**: grouped by creator, newest first, with a creator filter. For YouTube entries, the poster is a **Watch on YouTube** link that opens the video in a new tab. **Play here** loads a `youtube-nocookie.com` embed in the card instead (nothing is requested from YouTube before then). YouTube sometimes shows "Sign in to confirm you're not a bot" inside embeds. The site can't detect or bypass that, so while a video plays inline a **Watch on YouTube** link and a short note appear above the player. On Android the poster and that link say **Open YouTube app** and use a Chrome intent link (`intent://…;package=com.google.android.youtube;S.browser_fallback_url=…`). It opens in the same tab and only when tapped, so the YouTube app can open instead of an in-app browser. If the app isn't installed, Chrome falls back to the normal YouTube page. Android cards also get a **Watch in browser** HTTPS link next to **Play here**, plus the hint "If the app does not open, open this page in Chrome and try again." Some in-app browsers ignore intent links, so the app may not open. Other systems keep normal **Watch on YouTube** links. Opening a video on YouTube stops whatever is playing on the page. Shorts switch to a portrait frame when playing. Local MP4s use the native video player.
- Only one item plays at a time. Starting a track or video stops the others. Changing Music/Videos, playlist or creator filter, or leaving the tab, stops playback and unloads any YouTube embed.
- The initial videos are all 18 owner-approved MED uploads from the month before 2026-11-08 (published 2026-10-10 to 2026-11-07) (channel MED LAST Z) and every public POW Ruthless upload (30). Titles, video IDs, publish dates and durations come from the public channel listings. New uploads from these two channels are added automatically by the daily Admin channel sync (see below).
- If no music has been added, the tab opens on Videos. Once any track exists it opens on Music.

### `media.json` schema
```json
{
  "music": [
    { "creatorId": "dawg", "creator": "DaWG", "member": "dawg", "tracks": [ TRACK, ... ] }
  ],
  "videos": [
    { "creatorId": "med", "creator": "MED", "member": "med",
      "channel": "MED LAST Z", "channelUrl": "https://www.youtube.com/@med.713",
      "items": [ VIDEO, ... ] }
  ]
}
```
- `creatorId` (required): a stable lowercase id (`a-z 0-9 - _`), unique within `music` and within `videos`. Use the member's roster filename where there is one (`dawg`, `kelgris`, `med`). POW Ruthless uses `ruthless` and links to the existing RuthlessX roster identity through `member`. `ROSTER.md` stays the identity authority; do not add members here.
- `creator` (required): the credit shown on the page, i.e. the creator's game name.
- `member` (optional): roster filename without `.png`. That member's existing badge is shown as the creator avatar (the original file is displayed, never edited).
- `channel` and `channelUrl` (optional, videos only): the YouTube channel name and its `https://www.youtube.com/@handle` URL.
- Array order is display order: playlists and creators appear as listed, tracks play top to bottom, and videos should be listed newest first.

A TRACK (music) is:
```json
{ "type": "audio", "title": "Song title", "src": "media/dawg/Song title.mp3", "duration": "3:12" }
```
A VIDEO is either a YouTube entry or a local MP4:
```json
{ "type": "youtube", "youtubeId": "AbCdEfGhIjK", "title": "Video title", "format": "video", "published": "2026-11-07", "duration": 286 }
{ "type": "video", "src": "media/med/Raid recap.mp4", "title": "Raid recap", "format": "short" }
```
(These are illustrations only. They are not in the live list.)
- `title` (required): exact title as supplied by the creator. Unicode and emoji are fine.
- `src` (local files): must start with `media/`, end in `.mp3` or `.m4a` (tracks) or `.mp4` (videos), and must not contain `..`, `\`, `%`, `?`, `#` or `:`. Write the real filename, spaces included. Do not URL-encode it; the page encodes it, and it works under the `/alliance-roster/` Pages path. M4A playback is supported by the player but has not been verified with a real M4A file yet — play the first approved M4A on the owner's phone before relying on it.
- `youtubeId`: the 11-character id from `youtube.com/watch?v=<id>` or `youtube.com/shorts/<id>`.
- `format` (optional): `"short"` for portrait/Shorts, otherwise `"video"`.
- `duration` (optional): seconds (`286`) or `"m:ss"` / `"h:mm:ss"`. `published` (optional): `YYYY-MM-DD`. Only fill these in from real data. Leave them out if unknown.
- Invalid entries are skipped and reported in the browser console. The rest of the list still shows.

### Adding approved uploads
The normal path is the approval screen (see Submissions & approvals): approve a
submission and it publishes itself — no manual download or commit. The manual
intake below is the fallback for files that arrive outside the form (e.g. Drive
folders shared directly by an artist).

Each artist's Google Drive folder (DaWG's and KelGris's are separate) is an **intake source only**. It is not a streaming URL and does not sync. Do not put Drive links in `media.json`.
1. Confirm the owner approved the file and get its title and the creator's game name from the submission.
2. Download it from Drive. MP3/M4A goes in `media/<creatorId>/` (e.g. `media/dawg/`), MP4 in `media/<creatorId>/` as well. Keep files modest: a few MB per track. Large videos should be uploaded to YouTube and added as a `youtube` entry instead. GitHub rejects files over 100 MB, and Pages sites should stay small. No paid hosting is needed.
3. Add one TRACK or VIDEO object to that creator's `tracks`/`items` array in the position it should appear. A new creator is one new object in `music` or `videos`.
4. Commit to `main`. The Pages build deploys it. Reload `?view=media` once Pages succeeds.

## Season Guides
The **Guides** tab (`?view=guides`) has one sub-tab per season, taken from `guides.json` in listed order. Link straight to a season with `?view=guides&season=s3`; without `season`, the manifest's `default` opens. Phones show the six top tabs as two rows of three.

- A season with no `sections` shows "No Season N guide yet", so future seasons can be listed before their guide is written.
- Each season: `id` (`a-z 0-9 - _`), `label`, optional `title`, `tagline`, `updated` (`YYYY-MM-DD`), `downloads` (`{ "label", "src": "guides/..." }`, PDF/PPTX/images only), `sources` (`{ "label", "url": "https://..." }`) and `sections`.
- A section has `id`, `heading` and any of: `intro`, `stats` (`{ value, label }`), `flow` (+ `flowLabel`), `list`, `steps` (`{ title, tag?, text }` + `stepsLabel`), `cards` (`{ title, tag?, tone?: "warn", lines }`), `table` (`{ columns, rows, highlightLast? }`) and `note`. A list/card line or note is a string or `{ "lead": "bold gold start", "text": "rest" }`. Everything renders as plain text.
- Adding or editing a guide is a manifest edit (plus any download files in `guides/<season>/`). Commit to `main` and reload once Pages succeeds.
- Guides are community-sourced; have them checked for accuracy before publishing.

## Submissions & approvals
Members submit from the **Submit** tab — no account, no Google sign-in. They pick
Music, Fan Art or YouTube video link, enter their game name and a title, upload the
original file or paste the link, and optionally add a description. They only see
"Submitted — awaiting approval" after the file is safely stored. Their game name is
remembered on their own device. Nothing goes public until the owner approves it.

- **Backend:** two Google Apps Script projects in `apps-script/` — a public
  submissions endpoint (private Drive folder + tracking Sheet) and a private,
  owner-only approval screen. Full setup takes ~15 minutes; see
  `apps-script/README.md`. Until the endpoint URL is pasted into `submit.js`, the
  Submit tab shows "Submissions are not open yet" and the form stays disabled.
- **Owner approval link:** the Admin web app URL (bookmark it; only the owner's
  Google account can open it). On it the owner previews submissions, corrects titles
  and game names, approves (publishes to GitHub automatically), rejects, or unpublishes
  an approved entry later. Approval reports the commit and a "Check live" button
  confirms the file is actually serving — approval and live deployment are different
  steps and the screen shows which one you are looking at.
- **Storage:** approved songs start on GitHub Pages (`media/<creatorId>/`, ~1–3.7 MB
  each). The site is ~280 MB of a 1 GB Pages limit; the approval screen refuses to
  publish past a 900 MB safety limit and shows the current size. Fan art publishes to
  `fanart/`. Originals stay private in Drive either way.
- **Fan art:** approved artwork appears in the **Fan Art** tab with its title, creator
  game name and description; tapping a piece opens it full size. The gallery shows an
  honest "No fan art yet" until the first piece is approved. Entries live in
  `fanart.json`: `{ "title", "creator", "description", "src": "fanart/<file>", "submissionId", "approved" }`.
- **YouTube:** the 48 existing approved entries (18 MED, 30 POW Ruthless) are untouched.
  Individual submitted links go through the approval queue. The Admin script syncs the
  owner-trusted MED and POW Ruthless channels once daily around 9 AM script time. With a
  YouTube API key saved in the private Admin settings it uses only the official YouTube Data
  API (uploads playlist → video details; new entries are `format: "video"` with the API's
  publish date; see `apps-script/README.md` for key setup). Without a key it reads the public
  Videos + Shorts tabs as follows. Each tab is read from the `/channel/<id>` URL, falling back
  to the channel's `@handle` URL; either page must report the configured channel ID.
  POW Ruthless: every new upload on its own grid is added. MED: unknown uploads listed
  above the newest already-listed one in the same tab are added; ones below it only with a
  real upload date on or after 2026-10-10 (no old backlog). The real upload date and length
  come from the watch page when YouTube returns them; otherwise the entry has no `published`
  date (it is never guessed), gets `discoveredAt`, and is placed in the tab's source order
  just above the already-listed entries. Videos whose watch page names another owner are
  skipped. Sync deduplicates by video ID, never changes or removes entries, notes a tab that
  failed, and fails without writing anything if both tabs of a channel can't be read.

## Rendering
The shared wheel uses a flat projection of its circular rotation, hides rear cards, and changes depth ordering only at card crossings (reusing the approach from PR #3). It avoids intersecting CSS 3D surfaces and permanent GPU promotion of every card. Images are loaded/decoded two at a time near the front, with dark loading placeholders. The rotation remains one turn per 110 seconds. Android-specific flashing still requires an actual phone check; DOM checks cannot verify a GPU/compositor result.

## Rules
- Approved character art, approved badge art, owner-approved member music and video (AI-made submissions included) in `media/` or as YouTube entries in `media.json`, and the page files only. No source screenshots or personal files.
- Phone-sourced images get their location metadata stripped before upload.
- Members appear under their game names.
- Private while the roster is being built. Goes public when the showcase page launches, so every member can view and download their character.
