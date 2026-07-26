import { expect, test } from '@playwright/test';
async function provideRates(page) {
  await page.route('https://cdn.jsdelivr.net/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      eur: { eur: 1, usd: 1.2, brl: 6.6 },
    }),
  }));
  await page.route('https://api.coinbase.com/**', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ data: { amount: '100000', currency: 'EUR' } }),
  }));
}

async function waitUntilReady(page) {
  await provideRates(page);
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

test('renders the exact qalc output for every help example', async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  testInfo.snapshotSuffix = '';
  await page.clock.setFixedTime(new Date('2026-01-02T15:04:05-03:00'));
  await waitUntilReady(page);

  const expressions = await page.locator('#help-body code.ex').allTextContents();
  expect(expressions.length).toBeGreaterThan(0);
  const results = [];

  for (const expression of expressions) {
    await test.step(expression, async () => {
      const entry = await evaluate(page, expression);
      await expect.soft(entry.locator('.entry-message.error')).toHaveCount(0);
      results.push({
        expression,
        output: await entry.locator('.entry-result, .entry-message').evaluateAll(
          (lines) => lines.map((line) => [line.className, line.innerHTML]),
        ),
      });
    });
  }
  expect(`${JSON.stringify(results, null, 2)}\n`).toMatchSnapshot('help-results.txt');
});

test('restores qalc settings by replaying expressions', async ({ page }) => {
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

test('clearing history immediately resets the calculator session', async ({ page }) => {
  await waitUntilReady(page);
  await evaluate(page, 'set precision 30');
  await expect((await evaluate(page, '1 / 7')).locator('.entry-result'))
    .toContainText('142857142857142857142857142857');
  await evaluate(page, '42');
  await evaluate(page, 'store cleartestvalue');
  await expect((await evaluate(page, 'cleartestvalue')).locator('.entry-result')).toContainText('42');

  let dialogCount = 0;
  page.once('dialog', (dialog) => {
    dialogCount += 1;
    dialog.accept();
  });
  await page.locator('#clear-btn').click({ force: true });
  await expect(page.locator('.entry')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('qalc.history.v1'))).toBeNull();
  expect(dialogCount).toBe(1);

  await expect(page.locator('#status')).toHaveClass(/ready/, { timeout: 30_000 });
  await expect((await evaluate(page, '1 / 7')).locator('.entry-result'))
    .not.toContainText('142857142857142857142857142857');
  await expect((await evaluate(page, 'cleartestvalue')).locator('.entry-result')).not.toContainText('42');
});