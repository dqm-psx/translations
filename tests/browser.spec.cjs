const { test: base, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { startServer } = require('./server.cjs');

const root = path.resolve(__dirname, '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const test = base.extend({
  siteServer: [async ({}, use) => {
    const server = await startServer(root);
    await use(server);
    await server.close();
  }, { scope: 'worker' }],
  // External requests are failures even when a connection would otherwise succeed.
  networkGuard: [async ({ page, context, siteServer }, use) => {
    const failures = [];
    const origin = new URL(siteServer.url).origin;
    page.on('pageerror', error => failures.push(error.message));
    await context.route(/^https?:/, route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      failures.push(`External request: ${route.request().url()}`);
      return route.abort();
    });
    await use();
    expect(failures).toEqual([]);
  }, { auto: true }],
});

async function openComparison(page, url) {
  await page.goto(url);
  await expect(page.locator('#comparison-rows > tr')).toHaveCount(100);
  await expect(page.locator('#count')).toHaveText('1–100 of 9,956 matching entries · 9,956 total');
}

async function visibleKeys(page) {
  return page.locator('#comparison-rows > tr').evaluateAll(rows => rows.map(row => row.dataset.key));
}

for (const protocol of ['file', 'http']) {
  test.describe(protocol === 'file' ? 'downloaded standalone file' : 'GitHub Pages project path', () => {
    let url;
    test.beforeEach(async ({ page, siteServer }) => {
      url = protocol === 'file' ? pathToFileURL(path.join(root, 'index.html')).href : siteServer.url;
      await openComparison(page, url);
    });

    test('renders the snapshot, searches, filters labels and differences', async ({ page }) => {
      await expect(page.getByRole('heading', { name: 'DQM 1+2 translation comparison' })).toBeVisible();
      await expect(page.getByRole('link', { name: /Back to (the )?guide/ })).toHaveAttribute('href', 'https://dqm-psx.github.io/guide/');
      await expect(page.locator('#comparison-table thead th')).toHaveCount(9);
      await expect(page.locator('#comparison-rows tr').first().locator('td').nth(4)).toHaveText('Desert World');
      const firstKey = (await visibleKeys(page))[0];

      await page.locator('#search').fill('s00046000_0000');
      await expect(page.locator('#comparison-rows > tr')).toHaveCount(2);
      expect(await visibleKeys(page)).toContain(firstKey);
      expect(await page.locator('#comparison-rows .entry').allTextContents()).toEqual(['s00046000_0000', 's00046000_0000']);
      await page.locator('#search').fill('no-match-dqm-translation-browser-check');
      await expect(page.locator('#empty-results')).toBeVisible();
      await expect(page.locator('#comparison-rows > tr')).toHaveCount(0);
      await page.locator('#clear-filters').click();

      await page.locator('[data-quick-label="Monster names"]').click();
      await expect(page.locator('#active-labels')).toContainText('Monster names');
      expect(await page.locator('#comparison-rows > tr').evaluateAll(rows =>
        rows.every(row => [...row.querySelectorAll('.tag')].some(tag => tag.textContent === 'Monster names')))).toBe(true);
      await page.locator('#different').check();
      const filteredKeys = await visibleKeys(page);
      expect(filteredKeys.length).toBeGreaterThan(0);
      const differentKeys = await page.evaluate(() => window.DQM_COMPARISON_CONTEXT.rows
        .filter(row => row.labels.includes('Monster names') && row.different).map(row => row.key));
      expect(filteredKeys).toEqual(differentKeys.slice(0, 100));

      await page.locator('#label-summary').click();
      await page.locator('#label-search').fill('Town names');
      await expect(page.locator('.label-option')).toHaveCount(1);
      await page.locator('[data-only-label="Town names"]').click();
      await expect(page.locator('#active-labels')).toContainText('Town names');
      await page.locator('#close-labels').click();
      await expect(page.locator('#label-picker')).not.toHaveAttribute('open', '');
      await page.locator('#clear-filters').click();
      await expect(page.locator('#count')).toHaveText('1–100 of 9,956 matching entries · 9,956 total');
    });

    test('paginates across the full snapshot and sorts matching rows', async ({ page }) => {
      const firstKey = (await visibleKeys(page))[0];
      await page.locator('#next-page').click();
      await expect(page.locator('#page-number')).toHaveValue('2');
      await expect(page.locator('#count')).toHaveText('101–200 of 9,956 matching entries · 9,956 total');
      expect((await visibleKeys(page))[0]).not.toBe(firstKey);
      await page.locator('#last-page').click();
      await expect(page.locator('#comparison-rows > tr')).toHaveCount(56);
      await expect(page.locator('#page-number')).toHaveValue('100');
      await expect(page.locator('#next-page')).toBeDisabled();
      await page.locator('#page-number').fill('3');
      await page.locator('#page-number').press('Enter');
      await expect(page.locator('#count')).toHaveText('201–300 of 9,956 matching entries · 9,956 total');
      await page.locator('#first-page').click();
      expect((await visibleKeys(page))[0]).toBe(firstKey);

      await page.locator('[data-quick-label="Town names"]').click();
      await page.locator('[data-sort="current"]').click();
      await expect(page.locator('#heading-current')).toHaveAttribute('aria-sort', 'ascending');
      const ascending = await page.locator('#comparison-rows td:nth-child(5)').allTextContents();
      const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
      expect(ascending.length).toBeGreaterThan(1);
      expect(ascending).toEqual([...ascending].sort(collator.compare));
      await page.locator('[data-sort="current"]').click();
      await expect(page.locator('#heading-current')).toHaveAttribute('aria-sort', 'descending');
      const descending = await page.locator('#comparison-rows td:nth-child(5)').allTextContents();
      expect(descending).toEqual([...ascending].reverse());
      await page.locator('#source-order').click();
      await expect(page.locator('#heading-current')).toHaveAttribute('aria-sort', 'none');
    });

    test('persists a suggestion and restores an exported backup', async ({ page }, testInfo) => {
      const suggestion = 'Browser check: さばくの世界 <test> & "quote"\nSecond line';
      const input = page.locator('textarea.suggestion').first();
      const key = await input.getAttribute('data-key');
      await input.fill(suggestion);
      await expect(page.locator('#suggestions-count')).toHaveText('1 suggestion');
      await page.reload();
      await expect(input).toHaveValue(suggestion);

      const downloadPromise = page.waitForEvent('download');
      await page.locator('#export-suggestions').click();
      const download = await downloadPromise;
      const backupPath = testInfo.outputPath('suggestions.json');
      await download.saveAs(backupPath);
      const backup = JSON.parse(await readFile(backupPath, 'utf8'));
      expect(backup.format).toBe('dqm-translation-suggestions');
      expect(backup.suggestions).toHaveLength(1);
      expect(backup.suggestions[0]).toMatchObject({ key, suggestion, baseline: { current: 'Desert World' } });

      // Restore into a genuinely blank draft, using the UI file importer.
      await input.fill('');
      await page.reload();
      await expect(input).toHaveValue('');
      await page.locator('#import-suggestions').setInputFiles(backupPath);
      await expect(page.locator('#suggestions-status')).toContainText('Imported 1;');
      await expect(input).toHaveValue(suggestion);
      await page.reload();
      await expect(input).toHaveValue(suggestion);
      await page.locator('#search').fill('Browser check:');
      await expect(page.locator('#comparison-rows > tr')).toHaveCount(1);
      expect(await visibleKeys(page)).toEqual([key]);
    });

    test('companion links resolve to the exact downloadable snapshot files', async ({ page, request }) => {
      const manifest = JSON.parse(await readFile(path.join(root, 'source-manifest.json'), 'utf8'));
      for (const [filename, hash] of Object.entries(manifest.published_sha256)) {
        expect(digest(await readFile(path.join(root, filename)))).toBe(hash);
        if (filename !== 'index.html') expect(hash).toBe(manifest.original_sha256[filename]);
      }
      await page.getByText('Sources and coverage', { exact: true }).click();
      const companions = [
        ['Plain Markdown table', 'DQM-translation-comparison.md'],
        ['Coverage report', 'coverage-report.json'],
        ['Full comparison data', 'comparison-data.json'],
      ];
      for (const [name, filename] of companions) {
        const link = page.getByRole('link', { name, exact: true });
        await expect(link).toHaveAttribute('href', filename);
        const href = await link.evaluate(anchor => anchor.href);
        const expected = await readFile(path.join(root, filename));
        let actual;
        if (protocol === 'file') {
          expect(fileURLToPath(href)).toBe(path.join(root, filename));
          actual = await readFile(fileURLToPath(href));
        } else {
          expect(new URL(href).pathname).toBe('/translations/' + filename);
          const response = await request.get(href);
          expect(response.ok()).toBe(true);
          actual = await response.body();
        }
        expect(actual.length).toBeGreaterThan(1000);
        expect(digest(actual)).toBe(digest(expected));
        if (filename.endsWith('.json')) {
          const document = JSON.parse(actual.toString('utf8'));
          expect(document.revision).toBe(await page.evaluate(() => window.DQM_COMPARISON_CONTEXT.revision));
          if (filename === 'comparison-data.json') {
            expect(document.rows).toHaveLength(9956);
            // Compare all embedded data without transferring the large snapshot out of the browser.
            const embeddedHash = await page.evaluate(async () => {
              const bytes = new TextEncoder().encode(JSON.stringify(window.DQM_COMPARISON_CONTEXT.rows));
              return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
                .map(value => value.toString(16).padStart(2, '0')).join('');
            });
            expect(embeddedHash).toBe(digest(JSON.stringify(document.rows)));
          }
          else expect(document.included_rows).toBe(9956);
        } else {
          expect(actual.toString('utf8')).toContain('Desert World');
        }
      }
    });

    test('keeps controls usable on a narrow screen and scrolls to suggestions', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(page.locator('#search')).toBeVisible();
      await expect(page.locator('#export-suggestions')).toBeVisible();
      const dimensions = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        table: document.getElementById('table-scroll').scrollWidth,
        container: document.getElementById('table-scroll').clientWidth,
      }));
      expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
      expect(dimensions.table).toBeGreaterThan(dimensions.container);
      await page.locator('#table-scroll').evaluate(element => { element.scrollLeft = element.scrollWidth; });
      const input = page.locator('textarea.suggestion').first();
      await input.scrollIntoViewIfNeeded();
      await expect(input).toBeInViewport();
      await input.fill('Narrow screen draft');
      await expect(page.locator('#suggestions-count')).toHaveText('1 suggestion');
      await page.locator('#next-page-bottom').click();
      await expect(page.locator('#page-number')).toHaveValue('2');
    });
  });
}
