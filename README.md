# alliance-roster

Alliance character roster: full-body character art for all ~100 members, plus the showcase page.

## Layout
- `characters/` — one file per member, named after the member (e.g. `characters/scatcat.png`). Every edit is a new commit, so the full revision history of each character is kept here.
- `badges/` — original member-created PNG badges. Use the same filename as the member's character: `badges/scatcat.png`, `badges/lion.png` for ŁIØN, `badges/baqian.png` for 仈仟, or `badges/ace-yen.png` for Ace ¥.
- `index.html` — a shared 3D carousel with **Characters** and **Badges** tabs. Both use the same rotating wheel, member directory, search, hover pause, and name-jump controls. Direct-link to badges with `?view=badges`.

## Uploading badges
1. Find the member's exact name and filename in `ROSTER.md`. Upload the approved original PNG to `badges/` with that filename, preserving the image bytes and artist credit. Do not regenerate or recompress it.
2. For someone without a completed character, add one row to **Badge-first members** in `ROSTER.md`: the exact game name and `badges/<confirmed-filename>.png`. Confirm unusual handles instead of guessing. Use lowercase ASCII letters, numbers, hyphens or underscores in filenames. The exact game name stays in the Member column.
3. Commit the upload (and any new roster row) to `main`. After Pages succeeds, reload `?view=badges`. No webpage or JSON edits are needed. Select a member and use **View full badge** to open their original artwork.

Missing badges display a dark **BADGE COMING SOON** placeholder. No badge artwork has been uploaded yet. Characters only lists members with an uploaded character; Badges lists all registered members, including those whose character is unfinished.

`ROSTER.md` is the single roster authority. `gallery-data.json` is a Jekyll template, generated automatically from its Member/File tables and the files in `characters/` and `badges/`. Do not maintain a separate member list in that template. `gallery.js` renders both views through the same wheel and directory. The existing static cards provide a fallback if the roster request fails.

When a badge-first member's character is completed, upload `characters/<same-filename>.png` and move their row to the Committed table, preserving their game name. Keep the existing committed order; the filename identifies the same person across both galleries. Never reuse one filename for different members. Existing search aliases for unusual handles are preserved.

Pages must continue to build with Jekyll from `main` at `/`; do not add `.nojekyll`. The roster JSON is generated at deployment, so uploads become available after the next successful Pages build.

## Rendering
The shared wheel uses a flat projection of its circular rotation, hides rear cards, and changes depth ordering only at card crossings (reusing the approach from PR #3). It avoids intersecting CSS 3D surfaces and permanent GPU promotion of every card. Images are loaded/decoded two at a time near the front, with dark loading placeholders. The rotation remains one turn per 110 seconds. Android-specific flashing still requires an actual phone check; DOM checks cannot verify a GPU/compositor result.

## Rules
- Approved character art, approved badge art, and the page files only. No source screenshots or personal files.
- Phone-sourced images get their location metadata stripped before upload.
- Members appear under their game names.
- Private while the roster is being built. Goes public when the showcase page launches, so every member can view and download their character.
