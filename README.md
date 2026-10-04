# DQM translation comparison

[Open the translation comparison](https://dqm-psx.github.io/translations/) ·
[Open the breeding guide](https://dqm-psx.github.io/guide/)

Compare 9,956 entries from the Dragon Quest Monsters 1 & 2 PlayStation translation
project alongside Japanese PS1, verified Japanese Game Boy Color, Current,
Game Boy, and Delocalized wording. Search all text, combine labels, show English
differences, and sort the complete selection before viewing 100 rows per page.

Suggestions are drafts saved only in this browser. Export suggestions to back
them up or share them; import an existing export to move them to this site.
Nothing is submitted to GitHub or the translation project. Drafts saved in a
different file or website do not automatically move here, so export them there
first. Existing row IDs and version-1 suggestion exports are preserved.

The **Theme** buttons offer **System**, **Light**, and **Dark**. System follows
your device's appearance, including changes while the page is open. Your choice
is remembered in this browser; when storage is unavailable it applies for the
current visit. Printed tables use the light palette.

## Open or host

Open `index.html` directly, or serve the repository with any static HTTP server.
The page embeds its data, styles, and scripts and needs no build step or external
resources. Keep its three download companions alongside it:

- `DQM-translation-comparison.md`: plain Markdown table.
- `comparison-data.json`: full structured comparison and source details.
- `coverage-report.json`: catalog coverage and verification evidence.

For GitHub Pages, use **Deploy from a branch**, branch **main**, folder **/(root)**.
The `.nojekyll` file allows these static files to be served unchanged.

## Source snapshot

Copied from [phakic/DQM-guide](https://github.com/phakic/DQM-guide), directory
`translation-project/build/translation-comparison`, at repository commit
`0ee1916ef0b9fba559a8a3eaec1073caed16ad3d`.
The wording snapshot was generated on September 28, 2026, from translation
revision `057877498252bac5cb42d35a1cb29286ecbec8f9` (clean working tree).
This is a preserved snapshot, not a live feed of translation changes.

The standalone HTML is renamed to `index.html`, has a link back to the guide,
and includes a theme picker and dark palette. Its embedded comparison data and
comparison/suggestion logic are unchanged. The three companion
downloads retain their original bytes. `source-manifest.json` records the
original and published SHA-256 hashes. No ROMs, disc images, or executables are
included.

To refresh, export all four matching artifacts together from the source project,
decompress the HTML and JSON if stored as `.gz`, preserve the guide link and
theme controls, and update the manifest. Preserve row keys so saved suggestion
exports remain usable.

## Test

```sh
npm ci
npx playwright install chromium
npm test
```

Tests exercise the standalone file and a static server mounted at `/translations/`,
including filtering, sorting, pagination, suggestion backups, and download links.
Test dependencies are not needed to use the page.
