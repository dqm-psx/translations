const { test: base, expect } = require('@playwright/test');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { startServer } = require('./server.cjs');

const root = path.resolve(__dirname, '..');
const test = base.extend({
  siteServer: [async ({}, use) => {
    const server = await startServer(root);
    await use(server);
    await server.close();
  }, { scope: 'worker' }],
});

test.beforeEach(async ({ page, siteServer }) => {
  await page.goto(siteServer.url);
  await expect(page.locator('#comparison-rows > tr')).toHaveCount(100);
});

test('shows the builder update date and current columns before opening selectors', async ({ page }) => {
  const manifest = JSON.parse(await readFile(path.join(root, 'source-manifest.json'), 'utf8'));
  await expect(page.locator('#builder-update-stamp')).toContainText('Last updated from the translation builder repository on');
  await expect(page.locator('#builder-repository')).toHaveAttribute('href', 'https://github.com/phakic/dqm1');
  await expect(page.locator('#builder-updated-at')).toHaveAttribute('datetime', manifest.updated_from_builder_at);
  await expect(page.locator('#builder-updated-at')).toHaveText(new Intl.DateTimeFormat('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
  }).format(new Date(manifest.updated_from_builder_at)));
  await expect(page.locator('.stamp')).toHaveCount(1);
  await expect(page.locator('#column-picker')).not.toHaveAttribute('open', '');
  await expect(page.locator('#visible-columns')).toContainText('Japanese-PSX · Current (EN) · Game Boy (EN) · Suggestions');
  await expect(page.locator('#suggestion-columns')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#comparison-columns').click();
  await expect(page.locator('#visible-columns')).toHaveText('Showing: Japanese-PSX · Current (EN) · Game Boy (EN)');
  await expect(page.locator('#comparison-columns')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#suggestion-columns')).toHaveAttribute('aria-pressed', 'false');
});

test('combines labels, keeps selections visible when closed, and returns keyboard focus', async ({ page }) => {
  await expect(page.locator('#quick-label-select')).toHaveValue('');
  await page.locator('#label-summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#label-search')).toBeFocused();
  for (const name of ['Town names', 'Gate names']) {
    await page.locator('#label-search').fill(name);
    await page.locator(`input[data-label="${name}"]`).check();
  }
  await expect(page.locator('#label-selection-status')).toHaveText('2 labels selected');
  await expect(page.locator('#quick-label-select')).toHaveValue('__selected__');
  await page.keyboard.press('Escape');
  await expect(page.locator('#label-picker')).not.toHaveAttribute('open', '');
  await expect(page.locator('#label-summary')).toBeFocused();
  for (const name of ['Town names', 'Gate names']) {
    await expect(page.getByRole('button', { name: `Remove label ${name}`, exact: true })).toBeVisible();
  }
  const expected = await page.evaluate(() => window.DQM_COMPARISON_CONTEXT.rows
    .filter(row => row.labels.some(label => ['Town names', 'Gate names'].includes(label))).slice(0, 100).map(row => row.key));
  expect(await page.locator('#comparison-rows > tr').evaluateAll(rows => rows.map(row => row.dataset.key))).toEqual(expected);
  await page.getByRole('button', { name: 'Remove label Town names', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#label-summary')).toBeFocused();
  await expect(page.locator('#quick-label-select')).toHaveValue('Gate names');
  await expect(page.locator('#label-selection-status')).toHaveText('1 label selected');
});

test('common-label selection preserves other filters and works with a keyboard', async ({ page }) => {
  await page.locator('#search').fill('a');
  await page.locator('#different').check();
  const select = page.locator('#quick-label-select');
  await select.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(select).toHaveValue('Monster names');
  await expect(select).toBeFocused();
  await expect(page.locator('#search')).toHaveValue('a');
  await expect(page.locator('#different')).toBeChecked();
  await page.locator('#clear-labels').click();
  await expect(select).toHaveValue('');
  await expect(page.locator('#search')).toHaveValue('a');
  await expect(page.locator('#different')).toBeChecked();
});

test('expanded selectors fit on a narrow screen in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['light', 'dark']) {
    await page.getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true }).click();
    for (const id of ['label-picker', 'column-picker']) {
      if (!(await page.locator(`#${id}`).evaluate(element => element.open))) {
        await page.locator(`#${id} > summary`).click();
      }
    }
    await expect(page.locator('#label-search')).toBeVisible();
    await expect(page.locator('input[data-column="suggestion"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
    const bounds = await page.locator('.view-section').evaluateAll(sections => sections.map(section => {
      const rect = section.getBoundingClientRect();
      return { left: rect.left, right: rect.right };
    }));
    expect(bounds.every(rect => rect.left >= 0 && rect.right <= 391)).toBe(true);
  }
});

test('original English source details preserve donor text and explain its edition attribution', async ({ page }) => {
  const donor = JSON.parse(await readFile(path.join(root, 'updates/clam-source-donors.json'), 'utf8'));
  await page.locator('#search').fill(donor.id);
  await expect(page.locator('#comparison-rows > tr')).toHaveCount(1);
  await expect(page.locator('#comparison-rows > tr')).toHaveAttribute('data-key', donor.key);
  await page.locator('#all-columns').click();
  for (const [index, edition] of [[6, 'gameboy'], [7, 'delocalized']]) {
    const cell = page.locator('#comparison-rows tr').first().locator('td').nth(index);
    expect(await cell.evaluate(element => [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join(''))).toBe(donor.display[edition]);
    const details = cell.locator('.english-source-details');
    await details.locator('summary').click();
    await expect(details.locator('.english-source-note')).toHaveText(donor.edition_notes[edition]);
    await expect(details.locator('.english-source-record')).toHaveCount(donor.english_sources.length);
    for (const [sourceIndex, source] of donor.english_sources.entries()) {
      const record = details.locator('.english-source-record').nth(sourceIndex);
      await expect(record.locator('h4')).toHaveText(source.title);
      await expect(record).toContainText(source.game);
      await expect(record).toContainText(source.record_id);
      await expect(record).toContainText(source.offset_hex);
      expect(await record.locator('pre').textContent()).toBe(source.text);
    }
  }
  await expect(page.locator('.english-source-details').nth(1)).toContainText('no separate DWM2 Delocalized source is supplied');
});
