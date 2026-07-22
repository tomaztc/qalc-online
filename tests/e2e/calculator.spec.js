import { expect, test } from '@playwright/test';

async function provideRates(page, usd = 1.2) {
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      eur: { eur: 1, usd },
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
  return entries.last();
}

test('evaluates normally, preserves ans, and converts units', async ({ page }) => {
  await waitUntilReady(page);

  await expect((await evaluate(page, '1 + 1')).locator('.entry-result')).toContainText('2');
  await expect((await evaluate(page, 'ans * 3')).locator('.entry-result')).toContainText('6');
  const conversion = await evaluate(page, '50 kg to lb');
  await expect(conversion.locator('.entry-result')).toContainText('lb');
  await expect(conversion.locator('.entry-result')).toContainText(/110\s+lb/);
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

test('persists qalc settings across reload', async ({ page }) => {
  await waitUntilReady(page);
  await evaluate(page, 'set precision 30');
  await expect((await evaluate(page, '1 / 7')).locator('.entry-result')).toContainText('142857142857142857142857142857');

  // Let the app's debounced IDBFS flush finish before reloading.
  await page.waitForTimeout(500);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#status')).toHaveClass(/ready/, { timeout: 30_000 });
  await expect((await evaluate(page, '1 / 7')).locator('.entry-result')).toContainText('142857142857142857142857142857');
});

test('clearing UI history does not clear qalc settings', async ({ page }) => {
  await waitUntilReady(page);
  await evaluate(page, 'set precision 30');
  await page.waitForTimeout(500);

  let dialogCount = 0;
  page.on('dialog', (dialog) => {
    dialogCount += 1;
    if (dialogCount === 1) dialog.accept();
    else dialog.dismiss();
  });
  await page.locator('#clear-btn').click();
  await expect(page.locator('.entry')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('qalc.history.v1'))).toBeNull();

  await page.reload();
  await expect(page.locator('#status')).toHaveClass(/ready/, { timeout: 30_000 });
  await expect((await evaluate(page, '1 / 7')).locator('.entry-result')).toContainText('142857142857142857142857142857');
});

test('can clear history and saved qalc settings together', async ({ page }) => {
  await waitUntilReady(page);
  await evaluate(page, 'set precision 30');
  await page.waitForTimeout(500);

  page.on('dialog', (dialog) => dialog.accept());
  const reloaded = page.waitForEvent('load');
  await page.locator('#clear-btn').click();
  await reloaded;
  await expect(page.locator('#status')).toHaveClass(/ready/, { timeout: 30_000 });

  const result = await evaluate(page, '1 / 7');
  await expect(result.locator('.entry-result')).not.toContainText('142857142857142857142857142857');
});
