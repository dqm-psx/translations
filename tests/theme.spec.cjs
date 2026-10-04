const { test: base, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { startServer } = require('./server.cjs');

const root = path.resolve(__dirname, '..');
const storageKey = 'dqm-translations-theme-v1';
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

async function expectTheme(page, choice, appearance) {
  await expect(page.locator('html')).toHaveAttribute('data-theme-choice', choice);
  await expect(page.locator('html')).toHaveAttribute('data-theme', appearance);
  const group = page.getByRole('group', { name: 'Theme', exact: true });
  await expect(group.locator('[aria-pressed="true"]')).toHaveCount(1);
  await expect(group.locator(`[data-theme-choice="${choice}"]`)).toHaveAttribute('aria-pressed', 'true');
}

for (const protocol of ['http', 'file']) {
  test(`${protocol}: follows system changes, then remembers a manual preference before the body renders`, async ({ page, siteServer }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.addInitScript(() => {
      // Observe the first applied appearance, before the large comparison data
      // is parsed, to catch a light flash when restoring a saved preference.
      new MutationObserver(() => {
        const theme = document.documentElement?.dataset.theme;
        if (theme && !window.firstThemeApplication) {
          window.firstThemeApplication = { theme, beforeBody: !document.body };
        }
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-theme'] });
    });
    const url = protocol === 'file' ? pathToFileURL(path.join(root, 'index.html')).href : siteServer.url;
    await openComparison(page, url);
    await expectTheme(page, 'system', 'dark');
    await page.emulateMedia({ colorScheme: 'light' });
    await expectTheme(page, 'system', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(page, 'system', 'dark');

    await page.getByRole('button', { name: 'Light', exact: true }).click();
    await expectTheme(page, 'light', 'light');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(page, 'light', 'light');
    expect(await page.evaluate(key => localStorage.getItem(key), storageKey)).toBe('light');
    await page.reload();
    await expectTheme(page, 'light', 'light');
    expect(await page.evaluate(() => window.firstThemeApplication)).toEqual({ theme: 'light', beforeBody: true });

    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await page.emulateMedia({ colorScheme: 'light' });
    await page.reload();
    await expectTheme(page, 'dark', 'dark');
    expect(await page.evaluate(() => window.firstThemeApplication)).toEqual({ theme: 'dark', beforeBody: true });
    await page.getByRole('button', { name: 'System', exact: true }).click();
    await expectTheme(page, 'system', 'light');
  });
}

test('theme controls work when browser storage is unavailable', async ({ page, siteServer }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() { throw new DOMException('Storage blocked for this test', 'SecurityError'); },
    });
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openComparison(page, siteServer.url);
  await expectTheme(page, 'system', 'dark');
  await page.getByRole('button', { name: 'Light', exact: true }).click();
  await expectTheme(page, 'light', 'light');
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  await expectTheme(page, 'dark', 'dark');
  await page.getByRole('button', { name: 'System', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await expectTheme(page, 'system', 'light');
  await page.locator('#search').fill('s00046000_0000');
  await expect(page.locator('#comparison-rows > tr')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('theme buttons are keyboard operable and fit a narrow mobile screen', async ({ page, siteServer }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await openComparison(page, siteServer.url);
  const group = page.getByRole('group', { name: 'Theme', exact: true });
  const system = group.getByRole('button', { name: 'System', exact: true });
  const light = group.getByRole('button', { name: 'Light', exact: true });
  const dark = group.getByRole('button', { name: 'Dark', exact: true });
  for (const button of [system, light, dark]) {
    await expect(button).toBeInViewport();
    const bounds = await button.boundingBox();
    expect(bounds.height).toBeGreaterThanOrEqual(36);
  }
  await system.focus();
  await page.keyboard.press('Tab');
  await expect(light).toBeFocused();
  await page.keyboard.press('Enter');
  await expectTheme(page, 'light', 'light');
  await page.keyboard.press('Tab');
  await expect(dark).toBeFocused();
  await page.keyboard.press('Space');
  await expectTheme(page, 'dark', 'dark');
  const focus = await dark.evaluate(element => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(focus.style).not.toBe('none');
  expect(focus.width).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
  await page.locator('#search').fill('s00046000_0000');
  await expect(page.locator('#comparison-rows > tr')).toHaveCount(2);
});

test('an open tab follows saved theme choices from another tab', async ({ page, context, siteServer }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openComparison(page, siteServer.url);
  const other = await context.newPage();
  try {
    await other.emulateMedia({ colorScheme: 'light' });
    await openComparison(other, siteServer.url);
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await expectTheme(other, 'dark', 'dark');
    await other.getByRole('button', { name: 'Light', exact: true }).click();
    await expectTheme(page, 'light', 'light');
    await page.getByRole('button', { name: 'System', exact: true }).click();
    await expectTheme(other, 'system', 'light');
    await other.emulateMedia({ colorScheme: 'dark' });
    await expectTheme(other, 'system', 'dark');
  } finally {
    await other.close();
  }
});

test('dark text stays readable across controls, labels, and comparison surfaces', async ({ page, siteServer }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await openComparison(page, siteServer.url);
  await expect(page.locator('#comparison-rows .text').first()).toHaveCSS('white-space', 'pre-wrap');
  await page.locator('#label-summary').click();
  const samples = await page.evaluate(() => {
    const parse = color => color.match(/[\d.]+/g).map(Number);
    function background(element) {
      if (!element) return [255, 255, 255];
      const rgba = parse(getComputedStyle(element).backgroundColor);
      const alpha = rgba[3] ?? 1;
      if (alpha === 1) return rgba.slice(0, 3);
      const behind = background(element.parentElement);
      return rgba.slice(0, 3).map((channel, index) => channel * alpha + behind[index] * (1 - alpha));
    }
    function luminance(rgb) {
      const linear = rgb.slice(0, 3).map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    }
    return [
      'h1', '.intro', '.stamp', 'nav a', '#search', '#clear-filters',
      '[data-theme-choice="system"][aria-pressed]', '[data-theme-choice="dark"][aria-pressed]',
      '.label-name', '.label-count', '.label-hint', '.editing-note', '#count',
      'th', '#comparison-rows td:nth-child(5)', '#comparison-rows .tag',
      '#comparison-rows .entry', '#comparison-rows tr:nth-child(2) .entry',
      '#comparison-rows .missing', '.source-details', 'textarea.suggestion',
    ].map(selector => {
      const element = document.querySelector(selector);
      if (!element) return { selector, missing: true };
      const foreground = luminance(parse(getComputedStyle(element).color));
      const behind = luminance(background(element));
      return { selector, ratio: (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05) };
    });
  });
  for (const sample of samples) {
    expect(sample.missing, `${sample.selector} must be represented`).toBeFalsy();
    expect(sample.ratio, `${sample.selector} contrast`).toBeGreaterThanOrEqual(4.5);
  }
});

test('printing uses the light palette while the saved screen appearance stays dark', async ({ page, siteServer }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await openComparison(page, siteServer.url);
  const colors = () => page.evaluate(() => {
    const selectors = ['html', 'body', 'h1', '.table-scroll', 'th', 'textarea.suggestion'];
    return selectors.map(selector => {
      const style = getComputedStyle(document.querySelector(selector));
      return { selector, color: style.color, background: style.backgroundColor, scheme: style.colorScheme };
    });
  });
  await page.emulateMedia({ media: 'print' });
  const lightPrint = await colors();
  await page.emulateMedia({ media: 'screen' });
  await page.getByRole('button', { name: 'Dark', exact: true }).click();
  const darkScreen = await colors();
  await page.emulateMedia({ media: 'print' });
  expect(await colors()).toEqual(lightPrint);
  await expect(page.getByRole('group', { name: 'Theme', exact: true })).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await expectTheme(page, 'dark', 'dark');
  expect(await colors()).toEqual(darkScreen);
});
