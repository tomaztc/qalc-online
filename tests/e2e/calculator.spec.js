import { expect, test } from '@playwright/test';

async function waitUntilReady(page) {
  await page.goto('/');
  await expect(page.locator('#status')).toContainText('Ready', { timeout: 30_000 });
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
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ date: '2026-07-22', eur: { eur: 1, usd: 2 } }),
  }));
  await page.route('https://api.coinbase.com/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ data: { amount: '100000', currency: 'EUR' } }),
  }));
  await waitUntilReady(page);

  await expect((await evaluate(page, 'exrates')).locator('.entry-result'))
    .toContainText('Exchange rates updated.');
  await expect((await evaluate(page, '100 USD to EUR')).locator('.entry-result'))
    .toContainText(/€50(?:\.0+)?/);
});

test('persists qalc settings across reload', async ({ page }) => {
  await waitUntilReady(page);
  await evaluate(page, 'set precision 30');
  await expect((await evaluate(page, '1 / 7')).locator('.entry-result')).toContainText('142857142857142857142857142857');

  // Let the app's debounced IDBFS flush finish before reloading.
  await page.waitForTimeout(500);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#status')).toContainText('Ready', { timeout: 30_000 });
  await expect((await evaluate(page, '1 / 7')).locator('.entry-result')).toContainText('142857142857142857142857142857');
});

test('clearing UI history does not clear qalc settings', async ({ page }) => {
  await waitUntilReady(page);
  await evaluate(page, 'set precision 30');
  await page.waitForTimeout(500);

  page.on('dialog', (dialog) => dialog.accept());
  await page.locator('#clear-btn').click();
  await expect(page.locator('.entry')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('qalc.history.v1'))).toBeNull();

  await page.reload();
  await expect(page.locator('#status')).toContainText('Ready', { timeout: 30_000 });
  await expect((await evaluate(page, '1 / 7')).locator('.entry-result')).toContainText('142857142857142857142857142857');
});
