# DQM translation comparison

[Open the translation comparison](https://dqm-psx.github.io/translations/) ·
[Open the breeding guide](https://dqm-psx.github.io/guide/)

Compare 9,956 entries from the Dragon Quest Monsters 1 & 2 PlayStation translation
project alongside Japanese PS1, verified Japanese Game Boy Color, Current,
Game Boy, and Delocalized wording. Search all text, combine labels, show English
differences, and sort the complete selection before viewing 100 rows per page.

The default view shows **PSX Japanese / Current / Game Boy / Suggestions**.
Open **Columns** below the label filters to select that preset or choose any of
the nine columns. **PSX / Current / Game Boy** selects the three main comparison
columns; **Show all columns** restores the full table. Existing saved selections
take precedence over the default. At least one column stays visible, and your
selection is remembered in this browser. Search still includes hidden columns,
and hiding Suggestions preserves your drafts. Printing uses the selected columns.

Write a draft in an entry's **Suggestions** column, then choose **Submit on
GitHub**. This opens a prefilled issue for you to review, add your reasoning,
and submit with your GitHub account. Issues are public. Each report includes
the suggested wording, current English, Japanese text, exact row key, catalog,
and snapshot revision so maintainers can identify the entry. Opening GitHub
does not submit the issue or clear your draft.

For long reports, the page offers **Copy issue text** and **Open GitHub**;
paste the full text into the issue body before submitting. If browser clipboard
access is unavailable, the text is selected for manual copying. No suggestion
is shortened. Submission uses GitHub's issue composer, with no site backend,
embedded credentials, or automatic issue processing.

Drafts still save in this browser. Open **Backup / restore drafts** to export
a JSON backup or import an existing export. Drafts saved in a different file
or website do not automatically move here, so export them there first.
Existing row IDs and version-1 suggestion exports are preserved.

The **Theme** buttons offer **System**, **Light**, and **Dark**. System follows
your device's appearance, including changes while the page is open. Your choice
is remembered in this browser; when storage is unavailable it applies for the
current visit. Dark mode uses the guide's charcoal and teal palette. Printed
tables use the light palette.

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
and includes a theme picker, dark palette, the original guide's column
controls adapted for standalone storage, and a GitHub issue submission layer.
Its local suggestion storage module is unchanged. Comparison focus handling
also keeps row actions available while a search or
suggestion sort waits to refresh. The three companion
downloads preserve the source snapshot, with reviewed display corrections applied
to the HTML, JSON, and Markdown together. The coverage report retains its original
bytes. `source-manifest.json` records the original and published SHA-256 hashes
and the changes between them. No ROMs, disc images, or executables are
included.

The Game Boy and Delocalized cells for `s00434000_0222`, `s00434000_0249`, and
`s00434000_0271` now display **Not verified**. These entries contained retained
project wording without established donor counterparts. Their raw source records
remain available under **Source & codes** and in `comparison-data.json`; Current
wording, row keys, and the original snapshot revision are preserved. Not verified
does not establish that a passage is absent from the original game. Preserve
these review corrections when refreshing until donor counterparts are verified.

To refresh, export all four matching artifacts together from the source project,
decompress the HTML and JSON if stored as `.gz`, preserve the guide link and
theme, column, and GitHub submission controls, and update the manifest.
Preserve row keys so saved suggestion exports remain usable.

## Test

```sh
npm ci
npx playwright install chromium
npm test
```

Tests exercise the standalone file and a static server mounted at `/translations/`,
including filtering, sorting, pagination, suggestion backups, download links,
and issue composer links with Unicode and long-text fallbacks. Tests intercept
GitHub navigation and never create real issues.
Test dependencies are not needed to use the page.
