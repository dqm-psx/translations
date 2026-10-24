# DQM translation comparison

[Open the translation comparison](https://dqm-psx.github.io/translations/) ·
[Open the breeding guide](https://dqm-psx.github.io/guide/)

Compare entries from the Dragon Quest Monsters 1 & 2 PlayStation translation
project alongside Japanese PS1, verified Japanese Game Boy Color, Current,
Game Boy, and Delocalized wording. Search all text, combine labels, show English
differences, and sort the complete selection before viewing 100 rows per page.

The **Labels** and **Columns** cards keep your current view visible. Use the
common-label dropdown for a quick view, or **Choose labels** to search all labels
and combine them. Selected labels stay visible as removable buttons; entries
match any selected label. Clearing labels keeps your search and differences filter.

The default **Suggest** preset shows **PSX Japanese / Current / Game Boy /
Suggestions**. **Compare** shows the three main comparison columns, and **All
columns** restores the full table. **Choose columns** lets you select any of the
nine columns. The visible column names always appear below the presets. Existing
saved selections take precedence over the default. At least one column stays
visible, and your selection is remembered in this browser. Search still includes
hidden columns, and hiding Suggestions preserves your drafts. Printing uses the
selected columns. Both selectors support keyboard navigation and Escape to close.

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

## Translation data and updates

The active translation fields are exported from the JSON catalogs in the
private [phakic/dqm1](https://github.com/phakic/dqm1) builder repository.
`source-manifest.json` identifies the source revision and generated files;
`comparison-data.json` and `coverage-report.json` retain the source evidence
and coverage details. The page's source date describes that recorded snapshot,
not the time the browser opened the page.

The comparison originally came from
[phakic/DQM-guide](https://github.com/phakic/DQM-guide), directory
`translation-project/build/translation-comparison`, at commit
`0ee1916ef0b9fba559a8a3eaec1073caed16ad3d`. Its September 28, 2026 snapshot
supplied the initial row keys and Game Boy source evidence. Historical evidence
is retained as provenance; it does not establish that a current PS1 line has a
verified Game Boy counterpart. Supplementary evidence is stored in `updates/`.

The exporter updates the embedded page data and all three downloads together,
then refreshes the manifest hashes. Stable row keys preserve saved suggestion
drafts. The public repository contains the site, translation data, and export
tool; the private builder, ROMs, disc images, and executables are not published.

Automatic publication runs in the private builder repository. Its workflow reads
the private catalogs, runs an exporter pinned to a reviewed public commit, and
pushes one commit containing only these five generated files:

- `index.html`
- `comparison-data.json`
- `coverage-report.json`
- `DQM-translation-comparison.md`
- `source-manifest.json`

The site uses static files and needs no browser credentials. The public test
workflow does not check out the private builder. A destination credential is
stored only as a secret in the private repository and is available only to its
final push step. Publication requires that one-time secret setup and the private
workflow's merge; adding the public exporter alone does not enable automatic
updates. See the private builder's
[`src/tools/public_translation_sync.md`](https://github.com/phakic/dqm1/blob/main/src/tools/public_translation_sync.md)
for setup and recovery instructions; that link requires builder access.

To refresh locally from an authorized builder checkout:

```sh
python tools/sync_builder_translations.py --builder-root /path/to/dqm1 --site-root .
```

Review the five generated files together, run the tests, and commit the complete
snapshot. Never copy a builder directory or its Git history into this repository.
When changing the exporter or its source evidence, review and publish that change
here first, then update the private workflow's pinned exporter commit and run it
on `main`.

## Test

```sh
npm ci
python -m unittest discover -s tests -p 'test_*.py'
python tools/donor_source_audit.py
npx playwright install chromium
npm test
```

Tests exercise the standalone file and a static server mounted at `/translations/`,
including filtering, sorting, pagination, suggestion backups, download links,
and issue composer links with Unicode and long-text fallbacks. Tests intercept
GitHub navigation and never create real issues.
Test dependencies are not needed to use the page.
