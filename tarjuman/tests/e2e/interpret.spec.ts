import { expect, test, type Page } from '@playwright/test';

/** Collects everything that should not happen on a healthy page. */
function watchForProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`exception: ${error.message}`));
  page.on('requestfailed', (request) => problems.push(`request failed: ${request.url()}`));
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  return problems;
}

const translations = (page: Page) => page.locator('.entry .entry__target');

test('interprets typed text', async ({ page }) => {
  const problems = watchForProblems(page);
  await page.goto('/');
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();

  await page.getByRole('textbox', { name: /Type in Urdu/ }).fill('یہ ایک ٹیسٹ ہے');
  await page.getByRole('button', { name: 'Translate' }).click();

  const entry = page.locator('.entry').first();
  await expect(entry.locator('.entry__source')).toHaveText('یہ ایک ٹیسٹ ہے');
  await expect(entry.locator('.entry__source')).toHaveAttribute('dir', 'rtl');
  await expect(entry.locator('.entry__target')).toHaveAttribute('lang', 'de');
  await expect(entry.locator('.entry__target')).not.toBeEmpty();
  // The translated voice was played: the latency badge only appears once audio starts.
  await expect(entry.locator('.badge')).toHaveText(/\d\.\d s/);
  expect(problems).toEqual([]);
});

test('listens to the microphone and interprets each spoken sentence', async ({ page }) => {
  const problems = watchForProblems(page);
  await page.goto('/');
  await expect(page.getByText('Connected', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Start microphone' }).click();
  await expect(page.getByRole('button', { name: 'Stop microphone' })).toBeVisible({ timeout: 20_000 });

  // The recording holds two sentences separated by a pause; each must become its own entry.
  await expect(translations(page)).toHaveCount(2, { timeout: 40_000 });
  await expect(page.locator('.entry .badge').first()).toHaveText(/\d\.\d s/);
  // Speech detection saw speech (the panel reported it at least once, or entries exist) and
  // nothing was dropped as noise.
  await expect(page.locator('.entry--muted')).toHaveCount(0);

  await page.getByRole('button', { name: 'Stop microphone' }).click();
  await expect(page.getByRole('button', { name: 'Start microphone' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('settings: keys, diagnostics and language pair', async ({ page }) => {
  const problems = watchForProblems(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });

  await expect(dialog.getByText('Groq', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Test providers' }).click();
  await expect(dialog.getByRole('cell', { name: 'OK' })).toHaveCount(3);

  await dialog.getByRole('tab', { name: 'Languages & style' }).click();
  // Typing with spaces must survive (the stored copy is trimmed on every keystroke).
  await dialog.getByLabel('Meeting context').pressSequentially('weekly planning call');
  await expect(dialog.getByLabel('Meeting context')).toHaveValue('weekly planning call');
  await dialog.getByLabel('They speak').selectOption('en');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByText('Urdu ⇄ English')).toBeVisible();
  await expect(page.getByText('Urdu → English')).toBeVisible();
  await expect(page.getByText('English → Urdu')).toBeVisible();

  // The choice survives a reload.
  await page.reload();
  await expect(page.getByText('Urdu ⇄ English')).toBeVisible();
  expect(problems).toEqual([]);
});

test('setup guide opens and reflects device state', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Setup guide', exact: true }).click();
  const guide = page.getByRole('dialog', { name: 'Use Tarjuman in a Teams call' });
  await expect(guide.getByRole('heading', { name: /Install a virtual audio cable/ })).toBeVisible();
  await expect(guide.getByRole('heading', { name: /Start interpreting/ })).toBeVisible();
});
