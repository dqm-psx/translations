const { test: base, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer } = require('./server.cjs');

const root = path.resolve(__dirname, '..');
const storageKey = 'dqm-translations:columns:v1';
const columns = ['labels', 'japanese_psx', 'japanese_gbc_dqm1', 'japanese_gbc_dqm2', 'current', 'current_menu', 'gameboy', 'delocalized', 'suggestion'];
const comparison = ['japanese_psx', 'current', 'gameboy'];
const test = base.extend({
  siteServer: [async ({}, use) => {
    const server = await startServer(root);
    await use(server);
    await server.close();
  }, { scope: 'worker' }],
});

async function openComparison(page, url) {
  await page.goto(url);
  await expect(page.locator('#comparison-rows > tr')).toHaveCount(100);
}

async function openPicker(page) {
  if (!(await page.locator('#column-picker').evaluate(element => element.open))) {
    await page.locator('#column-summary').click();
  }
}

async function expectColumns(page, selected) {
  await expect(page.locator('#column-summary')).toHaveText(`Columns · ${selected.length} of 9`);
  // Check every rendered row as well as the headers so pagination and filtering
  // cannot silently restore cells hidden by a previous selection.
  const visible = await page.locator('#comparison-table').evaluate(table => ({
    headings: [...table.querySelectorAll('thead th')].map(cell => getComputedStyle(cell).display !== 'none'),
    rows: [...table.querySelectorAll('tbody tr')].map(row => [...row.cells].map(cell => getComputedStyle(cell).display !== 'none')),
  }));
  const expected = columns.map(column => selected.includes(column));
  expect(visible.headings).toEqual(expected);
  expect(visible.rows.length).toBeGreaterThan(0);
  for (const row of visible.rows) expect(row).toEqual(expected);
  await expect(page.locator('#comparison-table colgroup col')).toHaveCount(selected.length);
}

for (const protocol of ['http', 'file']) {
  test(`${protocol}: custom column choices persist across reloads and keep the remaining table aligned`, async ({ page, siteServer }) => {
    const url = protocol === 'file' ? pathToFileURL(path.join(root, 'index.html')).href : siteServer.url;
    await openComparison(page, url);
    await expectColumns(page, columns);
    const fullWidth = await page.locator('#comparison-table').evaluate(table => table.getBoundingClientRect().width);
    await openPicker(page);
    const choices = page.locator('#column-picker input[data-column]');
    await expect(choices).toHaveCount(9);
    for (const choice of await choices.all()) await expect(choice).toHaveAttribute('aria-controls', 'comparison-table');
    for (const column of ['japanese_gbc_dqm1', 'japanese_gbc_dqm2', 'current_menu', 'delocalized', 'suggestion']) {
      await page.locator(`input[data-column="${column}"]`).uncheck();
    }
    const selected = ['labels', ...comparison];
    await expectColumns(page, selected);
    expect(await page.locator('#comparison-table').evaluate(table => table.getBoundingClientRect().width)).toBeLessThan(fullWidth);
    expect(JSON.parse(await page.evaluate(key => localStorage.getItem(key), storageKey))).toEqual(selected);
    await page.reload();
    await expect(page.locator('#comparison-rows > tr')).toHaveCount(100);
    await expectColumns(page, selected);
    const alignment = await page.locator('#comparison-table').evaluate(table => {
      const visible = elements => [...elements].filter(element => getComputedStyle(element).display !== 'none');
      const headings = visible(table.querySelectorAll('thead th'));
      const cells = visible(table.querySelector('tbody tr').cells);
      return headings.map((heading, index) => Math.abs(heading.getBoundingClientRect().left - cells[index].getBoundingClientRect().left));
    });
    expect(alignment.every(offset => offset < 1)).toBe(true);
  });
}

test('presets and keyboard controls keep at least one column visible', async ({ page, siteServer }) => {
  await openComparison(page, siteServer.url);
  await page.locator('#column-summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#column-picker')).toHaveAttribute('open', '');
  await page.getByRole('button', { name: 'PSX / Current / Game Boy', exact: true }).click();
  await expectColumns(page, comparison);
  await page.locator('input[data-column="japanese_psx"]').uncheck();
  await page.locator('input[data-column="gameboy"]').uncheck();
  await expectColumns(page, ['current']);
  await expect(page.locator('input[data-column="current"]')).toBeChecked();
  await expect(page.locator('input[data-column="current"]')).toBeDisabled();
  await page.locator('input[data-column="labels"]').check();
  await expect(page.locator('input[data-column="current"]')).toBeEnabled();
  await page.locator('#all-columns').click();
  await expectColumns(page, columns);
  await expect(page.locator('#column-picker input:disabled')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#column-picker')).not.toHaveAttribute('open', '');
  await expect(page.locator('#column-summary')).toBeFocused();
});

test('hidden columns stay hidden through filtering, sorting and paging, while suggestions remain searchable and saved', async ({ page, siteServer }) => {
  await openComparison(page, siteServer.url);
  const draft = 'Column selection draft: さばくの世界';
  const input = page.locator('textarea.suggestion').first();
  const key = await input.getAttribute('data-key');
  await input.fill(draft);
  await openPicker(page);
  await page.locator('#comparison-columns').click();
  await expectColumns(page, comparison);
  await page.locator('#search').fill(draft);
  await expect(page.locator('#comparison-rows > tr')).toHaveCount(1);
  await expect(page.locator('#comparison-rows > tr')).toHaveAttribute('data-key', key);
  await expectColumns(page, comparison);
  await page.locator('#search').fill('s00046000_0000');
  await expect(page.locator('#comparison-rows > tr')).toHaveCount(2);
  await expectColumns(page, comparison);
  await page.locator('#clear-filters').click();
  await page.locator('[data-quick-label="Monster names"]').click();
  await expect(page.locator('#active-labels')).toContainText('Monster names');
  await page.locator('[data-sort="current"]').click();
  await expect(page.locator('#heading-current')).toHaveAttribute('aria-sort', 'ascending');
  await expectColumns(page, comparison);
  await page.locator('#next-page').click();
  await expect(page.locator('#page-number')).toHaveValue('2');
  await expectColumns(page, comparison);
  await page.locator('#clear-filters').click();
  await page.locator('#source-order').click();
  await openPicker(page);
  await page.locator('#all-columns').click();
  await expectColumns(page, columns);
  await expect(input).toHaveValue(draft);
  await page.reload();
  await expect(input).toHaveValue(draft);
});

test('corrupt preferences fall back to all columns and blocked storage does not prevent selection', async ({ page, siteServer }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await openComparison(page, siteServer.url);
  for (const saved of ['{bad json', '[]', '["unknown-column"]']) {
    await page.evaluate(({ key, saved }) => localStorage.setItem(key, saved), { key: storageKey, saved });
    await page.reload();
    await expectColumns(page, columns);
  }
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('Storage blocked for this test', 'SecurityError'); },
    });
  });
  await page.reload();
  await expectColumns(page, columns);
  await openPicker(page);
  await page.locator('#comparison-columns').click();
  await expectColumns(page, comparison);
  await page.locator('#all-columns').click();
  await expectColumns(page, columns);
  expect(errors).toEqual([]);
});

test('column controls fit a dark mobile screen and printing preserves the chosen columns', async ({ page, siteServer }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openComparison(page, siteServer.url);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await openPicker(page);
  for (const control of await page.locator('#column-picker input[data-column], #comparison-columns, #all-columns').all()) {
    await expect(control).toBeVisible();
    const bounds = await control.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.locator('#comparison-columns').click();
  await expectColumns(page, comparison);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('#column-picker')).toBeHidden();
  await expectColumns(page, comparison);
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectColumns(page, comparison);
});
