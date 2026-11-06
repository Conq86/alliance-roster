# alliance-roster

Alliance character roster: full-body character art for all ~100 members, plus the showcase page.

## Layout
- `characters/` — one file per member, named after the member (e.g. `characters/scatcat.png`). Every edit is a new commit, so the full revision history of each character is kept here.
- `badges/` — member-created badge images. Use the **same PNG filename** as the matching file in `characters/` so the two views share the existing member order and directory (for example, `badges/scatcat.png`, `badges/lion.png` for ŁIØN, and `badges/baqian.png` for 仈仟).
- `index.html` — a shared 3D carousel with **Characters** and **Badges** tabs. Both use the same rotating wheel, member directory, search, hover pause, and name-jump controls. Direct-link to badges with `?view=badges`.

## Badge rollout
- The badge gallery is ready for images but **badge artwork has not been added**. Missing badges display a clearly labeled placeholder, never a character image disguised as a badge.
- Upload the original member-approved badge files into `badges/` using the matching character filenames; keep artist credit and original art intact. No generator is needed.
- The gallery reads the existing character cards and names in `index.html` rather than maintaining a second roster or hard-coded badge list.
- Review the badges tab before merging this branch into `main`. The existing live Characters view remains unchanged until the merge is authorized.

## Rules
- Approved character art, approved badge art, and the page files only. No source screenshots or personal files.
- Phone-sourced images get their location metadata stripped before upload.
- Members appear under their game names.
- Private while the roster is being built. Goes public when the showcase page launches, so every member can view and download their character.
