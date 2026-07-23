import { expect, test } from '@playwright/test';

async function provideRates(page, usd = 1.2) {
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      eur: { eur: 1, usd, brl: 6.6 },
    }),
  }));
  await page.route('https://api.coinbase.com/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ data: { amount: '100000', currency: 'EUR' } }),
  }));
}

async function waitUntilReady(page, usd) {
  await provideRates(page, usd);
  await page.goto('/');
  await expect(page.locator('#status')).toHaveClass(/ready/, { timeout: 30_000 });
  await expect(page.locator('#status')).toBeEmpty();
}

async function evaluate(page, expression) {
  const entries = page.locator('.entry');
  const count = await entries.count();
  await page.locator('#expr').fill(expression);
  await page.locator('#expr').press('Enter');
  await expect(entries).toHaveCount(count + 1);
  return entries.first();
}

test('provides Chrome with an installable web app manifest', async ({ page }) => {
  await page.goto('/');
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifest = await page.evaluate(async (href) => {
    const response = await fetch(href);
    return response.json();
  }, manifestHref);

  expect(manifest).toMatchObject({
    id: './',
    name: 'Qalc Online',
    start_url: './',
    scope: './',
    display: 'standalone',
  });

  const iconSizes = await page.evaluate(async ({ href, icons }) => Promise.all(icons.map((icon) => (
    new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(`${image.naturalWidth}x${image.naturalHeight}`);
      image.onerror = reject;
      image.src = new URL(icon.src, new URL(href, location.href));
    })
  ))), { href: manifestHref, icons: manifest.icons });
  expect(iconSizes).toEqual(['192x192', '512x512']);
});

test('defaults to the system theme and persists Dark and Light choices', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 320, height: 640 });
  await waitUntilReady(page);
  const themeButton = page.locator('#theme-btn');

  await expect(themeButton).toHaveText('Dark');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  await themeButton.click({ force: true });
  await expect(themeButton).toHaveText('Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(12, 12, 12)');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);

  await page.reload();
  await expect(themeButton).toHaveText('Light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.evaluate(() => localStorage.removeItem('qalc.theme.v1'));
  await page.reload();
  await expect(themeButton).toHaveText('Dark');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme');
});

test('shows the expression above newest-first history with text controls', async ({ page }) => {
  await waitUntilReady(page);

  await expect(page.locator('#help-btn')).toHaveText('Help');
  await expect(page.locator('#clear-btn')).toHaveText('Clear');
  await expect(page.locator('.input-wrap')).toHaveCSS('box-shadow', 'none');
  const inputHeight = await page.locator('#inputbar').evaluate((element) => element.clientHeight);
  await page.locator('#expr').fill('1 + 1');
  await expect(page.locator('#preview')).toBeVisible();
  await expect(page.locator('#inputbar #preview')).toHaveCount(1);
  await expect(page.locator('#preview')).toHaveCSS('border-top-width', '0px');
  await expect(page.locator('#preview')).toHaveCSS('scrollbar-width', 'none');
  await expect.poll(() => page.locator('#inputbar').evaluate((element) => element.clientHeight))
    .toBe(inputHeight);
  await evaluate(page, '1 + 1');
  await evaluate(page, '2 + 2');

  await expect(page.locator('.entry').nth(0)).toContainText('2 + 2');
  await expect(page.locator('.entry').nth(1)).toContainText('1 + 1');
  const inputTop = await page.locator('#inputbar').evaluate((element) => element.offsetTop);
  const historyTop = await page.locator('#history').evaluate((element) => element.offsetTop);
  expect(inputTop).toBeLessThan(historyTop);
});

test('evaluates normally, preserves ans, and converts units', async ({ page }) => {
  await waitUntilReady(page);

  await expect((await evaluate(page, '1 + 1')).locator('.entry-result')).toContainText('2');
  await expect((await evaluate(page, 'ans * 3')).locator('.entry-result')).toContainText('6');
  const conversion = await evaluate(page, '50 kg to lb');
  await expect(conversion.locator('.entry-result')).toContainText('lb');
  await expect(conversion.locator('.entry-result')).toContainText(/110\s+lb/);
});

test('preserves semantic result lines and leaves long results to browser reflow', async ({ page }) => {
  await waitUntilReady(page);

  const equation = await evaluate(page, '2y+5=10');
  await expect(equation.locator('.entry-result')).toHaveCount(2);
  await expect(equation.locator('.entry-result').nth(0)).toContainText('((2 × y) + 5) = 10');
  await expect(equation.locator('.entry-result').nth(1)).toContainText('y = 5/2 = 2.5');

  const gravity = await evaluate(
    page,
    '(G * planet(earth; mass) * planet(mars; mass))/(54.6e6 km)^2',
  );
  await expect(gravity.locator('.entry-result')).toHaveCount(1);
  await expect(gravity.locator('.entry-result')).toContainText(/85\.80\s+PN/);
});

test('downloads and loads current exchange rates', async ({ page }) => {
  await waitUntilReady(page, 2);

  await expect((await evaluate(page, '100 USD to EUR')).locator('.entry-result'))
    .toContainText(/€50(?:\.0+)?/);
});

test('blocks unavailable commands before they reach qalc', async ({ page }) => {
  await waitUntilReady(page);

  const blocked = await evaluate(page, 'quit');
  await expect(blocked.locator('.entry-message.error')).toContainText('Unavailable:');
  await expect(page.locator('#expr')).toBeEnabled();
  await expect((await evaluate(page, '1 + 1')).locator('.entry-result')).toContainText('2');
});

test('restores qalc settings by replaying expressions without IndexedDB', async ({ page }) => {
  await waitUntilReady(page);
  await evaluate(page, 'set precision 30');
  await expect((await evaluate(page, '1 / 7')).locator('.entry-result')).toContainText('142857142857142857142857142857');

  await page.reload();
  await expect(page.locator('#status')).toHaveClass(/ready/, { timeout: 30_000 });
  await expect(page.locator('.entry')).toHaveCount(2);
  await expect((await evaluate(page, '1 / 7')).locator('.entry-result')).toContainText('142857142857142857142857142857');
  await expect.poll(() => page.evaluate(async () => (await indexedDB.databases())
    .map((database) => database.name))).not.toContain('/qalc');
});

test('clearing history resets replayed settings on the next load', async ({ page }) => {
  await waitUntilReady(page);
  await evaluate(page, 'set precision 30');

  let dialogCount = 0;
  page.once('dialog', (dialog) => {
    dialogCount += 1;
    dialog.accept();
  });
  await page.locator('#clear-btn').click({ force: true });
  await expect(page.locator('.entry')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('qalc.history.v1'))).toBeNull();
  expect(dialogCount).toBe(1);

  await page.reload();
  await expect(page.locator('#status')).toHaveClass(/ready/, { timeout: 30_000 });
  await expect((await evaluate(page, '1 / 7')).locator('.entry-result'))
    .not.toContainText('142857142857142857142857142857');
});

test('replays a currency conversion in a new page without hanging', async ({ page, context }) => {
  await waitUntilReady(page);
  await expect((await evaluate(page, '1 USD to BRL')).locator('.entry-result'))
    .toContainText(/BRL\s+5\.5/);
  await page.close();

  const restoredPage = await context.newPage();
  await provideRates(restoredPage);
  await restoredPage.goto('/');
  await expect(restoredPage.locator('#status')).toHaveClass(/ready/, { timeout: 30_000 });
  await expect(restoredPage.locator('.entry')).toHaveCount(1);
  await expect(restoredPage.locator('.entry').first()).toContainText('1 USD to BRL');
  await expect(restoredPage.locator('.entry-result')).toContainText(/BRL\s+5\.5/);
  await restoredPage.close();
});

test('evaluates every expression shown in the help window without errors', async ({ page }) => {
  test.setTimeout(300_000);
  await waitUntilReady(page);

  const expressions = await page.locator('#help-body code.ex').allTextContents();
  expect(expressions.length).toBeGreaterThan(0);

  for (const expression of expressions) {
    await test.step(expression, async () => {
      const entry = await evaluate(page, expression);
      await expect.soft(entry.locator('.entry-message.error')).toHaveCount(0);
    });
  }
});

test('evaluates partial fractions without crashing', async ({ page }) => {
  await waitUntilReady(page);
  await page.locator('#expr').fill('1/(x^2+2x-3) to partial fraction');
  await expect(page.locator('#preview')).toBeVisible();
  await page.locator('#expr').press('Enter');
  await expect(page.locator('.entry-result')).toContainText('x');
  await expect(page.locator('.entry-message.error')).toHaveCount(0);
});
