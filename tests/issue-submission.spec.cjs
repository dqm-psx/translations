const { test: base, expect } = require('@playwright/test');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer } = require('./server.cjs');

const root = path.resolve(__dirname, '..');
const issueUrl = 'https://github.com/dqm-psx/translations/issues/new';
const test = base.extend({
  siteServer: [async ({}, use) => {
    const server = await startServer(root);
    await use(server);
    await server.close();
  }, { scope: 'worker' }],
  // Exercise the visitor's handoff without opening GitHub or creating an issue.
  safeHandoff: [async ({ page, context, siteServer }, use) => {
    const failures = [];
    const origin = new URL(siteServer.url).origin;
    page.on('pageerror', error => failures.push(error.message));
    await context.route(/^https?:/, route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      failures.push(`Unexpected external request: ${route.request().url()}`);
      return route.abort();
    });
    await page.addInitScript(() => {
      window.issueHandoffs = [];
      window.copiedIssueTexts = [];
      window.rejectClipboard = false;
      window.open = (...args) => {
        window.issueHandoffs.push(args);
        // noopener can return null even when the browser opened the new tab.
        return null;
      };
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          async writeText(text) {
            if (window.rejectClipboard) throw new DOMException('Clipboard denied', 'NotAllowedError');
            window.copiedIssueTexts.push(text);
          },
        },
      });
    });
    await use();
    expect(failures).toEqual([]);
  }, { auto: true }],
});

async function openComparison(page, url) {
  await page.goto(url);
  await expect(page.locator('#comparison-rows > tr')).toHaveCount(100);
  await expect(page.locator('#comparison-rows .submit-suggestion')).toHaveCount(100);
}

function firstSuggestion(page) {
  const row = page.locator('#comparison-rows > tr').first();
  return { row, input: row.locator('textarea.suggestion'), submit: row.locator('.submit-suggestion') };
}

async function metadata(page, key) {
  return page.evaluate(key => ({
    row: window.DQM_COMPARISON_CONTEXT.rows.find(row => row.key === key),
    revision: window.DQM_COMPARISON_CONTEXT.revision,
  }), key);
}

async function savedDrafts(page) {
  return page.evaluate(() => Object.fromEntries(Object.entries(localStorage)
    .filter(([key]) => key.startsWith('dqm-translation-suggestions:v1:'))));
}

function expectIssueDestination(value) {
  const url = new URL(value);
  expect(url.origin + url.pathname).toBe(issueUrl);
  expect(url.searchParams.get('template')).toBe('translation-suggestion.md');
  expect(url.searchParams.get('title')).toBeTruthy();
  expect(url.searchParams.has('labels')).toBe(false);
  expect(url.searchParams.has('assignees')).toBe(false);
  return url;
}

function expectBody(body, draft, source) {
  expect(body).toContain(draft);
  for (const field of ['key', 'table', 'id', 'source_id', 'catalog', 'current', 'japanese_psx']) {
    if (source.row[field]) expect(body, `Issue includes ${field}`).toContain(source.row[field]);
  }
  expect(body).toContain(source.revision);
  expect(body).toContain('https://dqm-psx.github.io/translations/');
  expect(body).toContain('Reason / context');
}

for (const protocol of ['http', 'file']) {
  test(`${protocol}: hands off the exact Unicode draft and row context without changing saved suggestions`, async ({ page, siteServer }) => {
    const url = protocol === 'file' ? pathToFileURL(path.join(root, 'index.html')).href : siteServer.url;
    await openComparison(page, url);
    const { input, submit } = firstSuggestion(page);
    await expect(submit).toBeDisabled();
    await input.fill(' \n\t\u3000');
    await expect(submit).toBeDisabled();
    const draft = '  さばくの世界 🐉 & + # ? % "quoted"\n```\n````\n<script>window.issueXss = true</script>\n@someone [link](https://example.invalid/)\n  ';
    const key = await input.getAttribute('data-key');
    const source = await metadata(page, key);
    await input.fill(draft);
    await expect(submit).toBeEnabled();
    expect(await page.evaluate(() => window.issueHandoffs)).toEqual([]);
    const saved = await savedDrafts(page);
    await submit.click();
    const handoffs = await page.evaluate(() => window.issueHandoffs);
    expect(handoffs).toHaveLength(1);
    const [destination, target, features] = handoffs[0];
    const issue = expectIssueDestination(destination);
    expectBody(issue.searchParams.get('body'), draft, source);
    expect(target).toBe('_blank');
    expect(features).toContain('noopener');
    expect(features).toContain('noreferrer');
    expect(await page.evaluate(() => window.issueXss)).toBeUndefined();
    expect(page.url()).toBe(url);
    await expect(input).toHaveValue(draft);
    await expect(submit).toBeEnabled();
    await expect(page.locator('#suggestions-count')).toHaveText('1 suggestion');
    expect(await savedDrafts(page)).toEqual(saved);
    await page.reload();
    await expect(input).toHaveValue(draft);
    await expect(submit).toBeEnabled();
  });
}

test('explains public GitHub submission and keeps backup controls available but collapsed', async ({ page, siteServer }) => {
  await openComparison(page, siteServer.url);
  await expect(page.locator('.editing-note')).toContainText(/GitHub account/i);
  await expect(page.locator('.editing-note')).toContainText(/public/i);
  await expect(page.locator('#suggestion-backups')).not.toHaveAttribute('open', '');
  await expect(page.locator('#export-suggestions')).toBeHidden();
  await page.getByText('Backup / restore drafts', { exact: true }).click();
  await expect(page.locator('#export-suggestions')).toBeVisible();
  await expect(page.locator('#import-suggestions')).toHaveAttribute('type', 'file');
  // All visible rows have exactly one action, even when currently disabled.
  expect(await page.locator('#comparison-rows > tr').evaluateAll(rows =>
    rows.every(row => row.querySelectorAll('.submit-suggestion').length === 1))).toBe(true);
});

test('identifies entries with the same source ID by their distinct full row keys', async ({ page, siteServer }) => {
  await openComparison(page, siteServer.url);
  await page.locator('#search').fill('s00046000_0000');
  const rows = page.locator('#comparison-rows > tr');
  await expect(rows).toHaveCount(2);
  const keys = [];
  for (let index = 0; index < 2; index++) {
    const row = rows.nth(index);
    const key = await row.getAttribute('data-key');
    keys.push(key);
    await row.locator('textarea.suggestion').fill(`Distinct entry ${index}: 砂漠`);
    await row.locator('.submit-suggestion').click();
  }
  expect(new Set(keys).size).toBe(2);
  const handoffs = await page.evaluate(() => window.issueHandoffs);
  expect(handoffs).toHaveLength(2);
  for (let index = 0; index < 2; index++) {
    const body = expectIssueDestination(handoffs[index][0]).searchParams.get('body');
    expect(body).toContain(keys[index]);
    expect(body).not.toContain(keys[1 - index]);
    expect(body).toContain(`Distinct entry ${index}: 砂漠`);
  }
});

test('restored drafts and newly rendered rows retain working actions through paging, filtering and column selection', async ({ page, siteServer }) => {
  await openComparison(page, siteServer.url);
  const { input, submit } = firstSuggestion(page);
  const draft = 'Imported issue draft: 砂漠の世界';
  await input.fill(draft);
  await page.getByText('Backup / restore drafts', { exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.locator('#export-suggestions').click();
  const download = await downloading;
  const backup = await readFile(await download.path());
  await input.fill('');
  await expect(submit).toBeDisabled();
  await page.locator('#import-suggestions').setInputFiles({
    name: 'saved-drafts.json', mimeType: 'application/json', buffer: backup,
  });
  await expect(input).toHaveValue(draft);
  await expect(submit).toBeEnabled();
  await page.locator('#next-page').click();
  await expect(page.locator('#page-number')).toHaveValue('2');
  await expect(page.locator('#comparison-rows .submit-suggestion')).toHaveCount(100);
  await expect(submit).toBeDisabled();
  await input.fill('Second page suggestion');
  await submit.click();
  expect(new URL((await page.evaluate(() => window.issueHandoffs))[0][0]).searchParams.get('body'))
    .toContain('Second page suggestion');
  await page.locator('#first-page').click();
  await expect(input).toHaveValue(draft);
  await expect(submit).toBeEnabled();
  await page.locator('#search').fill(draft);
  await expect(page.locator('#comparison-rows > tr')).toHaveCount(1);
  await expect(page.locator('#comparison-rows .submit-suggestion')).toHaveCount(1);
  await page.locator('#column-summary').click();
  await page.locator('input[data-column="suggestion"]').uncheck();
  await expect(submit).toBeHidden();
  await page.locator('input[data-column="suggestion"]').check();
  await expect(submit).toBeVisible();
  await expect(submit).toBeEnabled();
  await submit.click();
  const handoffs = await page.evaluate(() => window.issueHandoffs);
  expect(handoffs).toHaveLength(2);
  expect(new URL(handoffs[1][0]).searchParams.get('body')).toContain(draft);
  await page.locator('#clear-filters').click();
  await page.locator('[data-sort="current"]').click();
  await expect(page.locator('#comparison-rows .submit-suggestion')).toHaveCount(100);
});

test('long suggestions preserve the complete issue text and offer a manual copy fallback on a dark mobile screen', async ({ page, siteServer }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openComparison(page, siteServer.url);
  const { input, submit } = firstSuggestion(page);
  const draft = '  LONG-BEGIN\n' + '長い提案 🐉 & + # ? %\n```markdown\n````\n'.repeat(180) + '\nLONG-END  ';
  const key = await input.getAttribute('data-key');
  const source = await metadata(page, key);
  await input.fill(draft);
  const saved = await savedDrafts(page);
  await page.evaluate(() => { window.rejectClipboard = true; });
  await submit.click();
  const dialog = page.getByRole('dialog', { name: 'Copy this suggestion to GitHub' });
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.issueHandoffs)).toEqual([]);
  const issueText = dialog.getByLabel('Complete issue text', { exact: true });
  await expect(issueText).toHaveAttribute('readonly', '');
  const body = await issueText.inputValue();
  expectBody(body, draft, source);
  expect(body).toContain('LONG-END  ');
  expect(await issueText.evaluate(element => ({
    selectionStart: element.selectionStart, selectionEnd: element.selectionEnd, scrollTop: element.scrollTop,
  }))).toEqual({ selectionStart: 0, selectionEnd: 0, scrollTop: 0 });
  expect(await dialog.evaluate(element => element.scrollTop)).toBe(0);
  const github = dialog.getByRole('link', { name: 'Open GitHub', exact: true });
  const destination = expectIssueDestination(await github.getAttribute('href'));
  expect(destination.searchParams.has('body')).toBe(false);
  await expect(github).toHaveAttribute('target', '_blank');
  expect(await github.getAttribute('rel')).toContain('noopener');
  expect(await github.getAttribute('rel')).toContain('noreferrer');
  await dialog.getByRole('button', { name: 'Copy issue text', exact: true }).click();
  await expect(dialog.locator('#issue-copy-status')).toContainText(/copy/i);
  await expect(issueText).toBeFocused();
  const selection = await issueText.evaluate(element => element.value.slice(element.selectionStart, element.selectionEnd));
  expect(selection).toBe(body);
  expect(await page.evaluate(() => window.copiedIssueTexts)).toEqual([]);
  await page.evaluate(() => { window.rejectClipboard = false; });
  await dialog.getByRole('button', { name: 'Copy issue text', exact: true }).click();
  expect(await page.evaluate(() => window.copiedIssueTexts)).toEqual([body]);
  await expect(dialog.locator('#issue-copy-status')).toContainText(/copied/i);
  const bounds = await dialog.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await expect(dialog).toHaveCSS('background-color', 'rgb(22, 32, 37)');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(submit).toBeFocused();
  await expect(input).toHaveValue(draft);
  expect(await savedDrafts(page)).toEqual(saved);
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await submit.click();
  await expect(dialog).toBeVisible();
  await expect(issueText).toHaveValue(body);
  await expect(dialog).not.toHaveCSS('background-color', 'rgb(22, 32, 37)');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(submit).toBeFocused();
});

test('GitHub handoff still uses the current draft when local storage is unavailable', async ({ page, siteServer }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('Storage unavailable for this test', 'SecurityError'); },
    });
  });
  await openComparison(page, siteServer.url);
  const { input, submit } = firstSuggestion(page);
  const draft = 'Unsaved browser draft: 砂漠';
  await input.fill(draft);
  await expect(submit).toBeEnabled();
  await submit.click();
  const handoffs = await page.evaluate(() => window.issueHandoffs);
  expect(handoffs).toHaveLength(1);
  expect(expectIssueDestination(handoffs[0][0]).searchParams.get('body')).toContain(draft);
  await expect(input).toHaveValue(draft);
  await expect(page.locator('#suggestions-status')).toContainText(/unavailable/i);
});

test('a delayed mouse click can submit an edited draft before its pending search refresh removes the row', async ({ page, siteServer }) => {
  await openComparison(page, siteServer.url);
  const { input, submit } = firstSuggestion(page);
  const searchDraft = 'Unique draft search: mouse submission';
  const replacement = 'Replacement wording that no longer matches';
  await input.fill(searchDraft);
  await page.locator('#search').fill(searchDraft);
  await expect(page.locator('#comparison-rows > tr')).toHaveCount(1);
  await input.fill(replacement);
  // A real mouse press can outlast the deferred refresh scheduled on blur.
  await submit.click({ delay: 150 });
  const handoffs = await page.evaluate(() => window.issueHandoffs);
  expect(handoffs).toHaveLength(1);
  expect(expectIssueDestination(handoffs[0][0]).searchParams.get('body')).toContain(replacement);
  await expect(submit).toBeFocused();
  await expect(page.locator('#comparison-rows > tr')).toHaveCount(1);
  // Leaving the submission controls must still apply the queued search update.
  await page.locator('#search').focus();
  await expect(page.locator('#comparison-rows > tr')).toHaveCount(0);
  await expect(page.locator('#empty-results')).toBeVisible();
});

test('keyboard users can pause on Submit on GitHub while a search refresh is pending', async ({ page, siteServer }) => {
  await openComparison(page, siteServer.url);
  await page.locator('#search').fill('s00046000_0000');
  await expect(page.locator('#comparison-rows > tr')).toHaveCount(2);
  const { input, submit } = firstSuggestion(page);
  const draft = 'Keyboard suggestion: 砂漠の世界';
  await input.fill(draft);
  await input.press('Tab');
  // Verify the button survives beyond both scheduled blur/focusout callbacks.
  await page.waitForTimeout(150);
  await expect(submit).toBeFocused();
  await page.keyboard.press('Enter');
  const handoffs = await page.evaluate(() => window.issueHandoffs);
  expect(handoffs).toHaveLength(1);
  expect(expectIssueDestination(handoffs[0][0]).searchParams.get('body')).toContain(draft);
  await expect(input).toHaveValue(draft);
});

test('a pending suggestion sort does not detach the button during a mouse press', async ({ page, siteServer }) => {
  await openComparison(page, siteServer.url);
  await page.locator('[data-sort="suggestion"]').click();
  const { input, submit } = firstSuggestion(page);
  const draft = 'ZZZ sorting suggestion: 勇者';
  await input.fill(draft);
  await submit.click({ delay: 150 });
  const handoffs = await page.evaluate(() => window.issueHandoffs);
  expect(handoffs).toHaveLength(1);
  expect(expectIssueDestination(handoffs[0][0]).searchParams.get('body')).toContain(draft);
  await expect(submit).toBeFocused();
  await expect(input).toHaveValue(draft);
});

test('a long-text dialog preserves its originating button until focus leaves the pending search', async ({ page, siteServer }) => {
  await openComparison(page, siteServer.url);
  const { input, submit } = firstSuggestion(page);
  const searchDraft = 'Unique draft search: long issue dialog';
  await input.fill(searchDraft);
  await page.locator('#search').fill(searchDraft);
  await expect(page.locator('#comparison-rows > tr')).toHaveCount(1);
  const draft = '長い提案 🐉 & + # ? %\n'.repeat(180) + 'Complete ending';
  await input.fill(draft);
  await submit.click({ delay: 150 });
  const dialog = page.getByRole('dialog', { name: 'Copy this suggestion to GitHub' });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(150);
  await expect(page.locator('#comparison-rows > tr')).toHaveCount(1);
  await expect(dialog.getByLabel('Complete issue text', { exact: true })).toHaveValue(new RegExp('Complete ending'));
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.waitForTimeout(150);
  await expect(submit).toBeFocused();
  await expect(input).toHaveValue(draft);
  expect(await page.evaluate(() => window.issueHandoffs)).toEqual([]);
  await page.locator('#search').focus();
  await expect(page.locator('#comparison-rows > tr')).toHaveCount(0);
  await expect(page.locator('#empty-results')).toBeVisible();
});
