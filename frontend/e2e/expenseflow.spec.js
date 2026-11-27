import { test, expect } from '@playwright/test';

const SHOTS = '../submission/screenshots';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`e2e-${Date.now()}`)]);

function lastWeekday(back = 2) {
  const d = new Date(); d.setDate(d.getDate() - back);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function login(page, who) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(`${who}@demo.expenseflow.test`);
  await page.getByLabel('Password').fill('demo123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();
}

async function logout(page) {
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
}

test('E2E-01 employee submits over-limit cab claim, manager approves it', async ({ page }) => {
  const title = `E2E cab ${Date.now()}`;
  // Render a realistic synthetic receipt to PNG (unique per run, so it is not a hash duplicate).
  await page.setContent(`<div style="font:16px monospace;width:320px;padding:20px;background:#fffdf7;border:1px solid #999">
    <b>UBER (SYNTHETIC)</b><br>Trip: Koramangala → MG Road<br>Date: ${lastWeekday()}<br>Ride id: ${Date.now()}<br><br>
    <b style="font-size:22px">TOTAL ₹2,600.00</b><br><small>demo data only</small></div>`);
  const receiptPng = await page.locator('div').first().screenshot();
  await page.goto('/login');
  await page.screenshot({ path: `${SHOTS}/01-login.png`, fullPage: true });
  await login(page, 'employee');
  await page.screenshot({ path: `${SHOTS}/02-my-claims.png`, fullPage: true });
  await page.goto('/claims/new');
  await page.getByLabel('Claim title').fill(title);
  await page.getByLabel('Category').first().selectOption('local_cab');
  await page.getByLabel('Amount (₹)').first().fill('2600');
  await page.getByLabel('Date').first().fill(lastWeekday());
  await page.getByLabel('Vendor').first().fill(`Uber E2E ${Date.now() % 100000}`);
  await page.locator('input[type=file]').first().setInputFiles({ name: 'cab.png', mimeType: 'image/png', buffer: receiptPng });
  await expect(page.getByText('cab.png')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-claim-editor.png`, fullPage: true });
  await page.getByRole('button', { name: 'Submit claim' }).click();
  await expect(page).toHaveURL(/\/claims\/\d+$/);
  await expect(page.getByText(/per-trip limit/)).toBeVisible();
  await expect(page.getByText(/Possible duplicate/)).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/04-claim-detail-policy-flags.png`, fullPage: true });
  await logout(page);

  await login(page, 'manager');
  await page.goto('/approvals');
  await page.screenshot({ path: `${SHOTS}/05-approvals-inbox.png`, fullPage: true });
  await page.getByRole('link', { name: new RegExp(title) }).first().click();
  await expect(page.getByRole('heading', { name: 'Your decision' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/06-review-side-by-side.png`, fullPage: true });
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText(/Approved\./)).toBeVisible();
});

test('E2E-02 phone width 390px: claim capture has no horizontal scroll and is keyboard reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page, 'employee');
  await page.goto('/claims/new');
  await expect(page.getByLabel('Claim title')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByLabel('Claim title').focus();
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => document.activeElement?.textContent?.includes('Submit claim'));
  }
  expect(reached).toBe(true);
  await page.screenshot({ path: `${SHOTS}/07-mobile-claim-capture-390px.png`, fullPage: true });
});

test('E2E-03 auditor queue filters and dashboard charts render', async ({ page }) => {
  await login(page, 'auditor');
  await page.goto('/audit');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/08-audit-queue-bulk.png`, fullPage: true });
  await page.goto('/dashboard');
  await expect(page.locator('svg').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/09-dashboard.png`, fullPage: true });
});

test('E2E-04 head sees payouts and policy configuration', async ({ page }) => {
  await login(page, 'head');
  await page.goto('/payouts');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/10-payouts.png`, fullPage: true });
  await page.goto('/policy');
  await expect(page.getByText('CAB_TRIP_LIMIT').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/11-policy-config.png`, fullPage: true });
});

test('E2E-05 employee cannot open finance pages', async ({ page }) => {
  await login(page, 'employee');
  await page.goto('/payouts');
  await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible();
  // and the API itself refuses, so hiding the page is not the only control
  const status = await page.evaluate(async () => (await fetch('/api/payouts')).status);
  expect(status).toBe(403);
});
