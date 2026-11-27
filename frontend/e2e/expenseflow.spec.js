import { writeFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

const SHOTS = '../submission/screenshots';
const EVIDENCE = '../submission/test-evidence';
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`e2e-${Date.now()}`)]);

function lastWeekday(back = 2) {
  const d = new Date(); d.setDate(d.getDate() - back);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Wait until a page is visually stable before an evidence screenshot: web fonts loaded, no loading
 * skeletons, no finite animation still running (including inside shadow roots, where NumberFlow
 * rolls its digits), pointer parked on an empty spot, and two consecutive frames pixel-identical.
 */
async function settle(page) {
  const vp = page.viewportSize();
  await page.mouse.move(Math.round(vp.width / 2), 2);                 // no hover highlight in the shot
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 15000 });
  await expect.poll(() => page.evaluate(() => {
    const all = [...document.getAnimations()];
    document.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) all.push(...el.shadowRoot.getAnimations()); });
    return all.filter((a) => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming?.().endTime)).length;
  }), { timeout: 10000 }).toBe(0);
  const still = { animations: 'disabled', caret: 'hide' };   // finite animations jump to their end state, infinite loops are cancelled
  let prev = await page.screenshot(still);
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(150);
    const next = await page.screenshot(still);
    if (next.equals(prev)) return;
    prev = next;
  }
  // Report which area kept changing, to make any future flake diagnosable.
  const box = await page.evaluate(() => {
    return document.getAnimations().filter((a) => a.playState === 'running').slice(0, 3)
      .map((a) => `${a.effect?.target?.outerHTML?.slice(0, 120)} ${JSON.stringify(a.effect?.getKeyframes?.()).slice(0, 160)}`);
  });
  throw new Error(`Page never became visually stable for the evidence screenshot; still animating: ${box.join(', ') || 'unknown'}`);
}

// Belt and braces: the config already asks for reduced motion; re-apply it per page so it is in force
// before the app's first render (decorative loops and rolling digits then never start).
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

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
  await expect(page.locator('.persona')).toHaveCount(5);            // all five demo personas rendered
  await expect(page.getByText('3-step')).toBeInViewport();           // hero stats not clipped
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/01-login.png`, fullPage: false, animations: 'disabled', caret: 'hide' });
  await login(page, 'employee');
  await expect(page).toHaveURL(/\/claims$/);
  await expect(page.getByRole('heading', { name: 'My claims' })).toBeVisible();
  await expect(page.locator('.claim-item').first().or(page.getByText('No claims yet'))).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/02-my-claims.png`, fullPage: false, animations: 'disabled', caret: 'hide' });
  await page.goto('/claims/new');
  await page.getByLabel('Claim title').fill(title);
  await page.getByLabel('Category').first().selectOption('local_cab');
  await page.getByLabel('Amount (₹)').first().fill('2600');
  await page.getByLabel('Date').first().fill(lastWeekday());
  await page.getByLabel('Vendor').first().fill(`Uber E2E ${Date.now() % 100000}`);
  await page.locator('input[type=file]').first().setInputFiles({ name: 'cab.png', mimeType: 'image/png', buffer: receiptPng });
  await expect(page.getByText('cab.png')).toBeVisible();
  await expect(page.locator('.total-value')).toContainText('2,600.00');   // settled claim total
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/03-claim-editor.png`, fullPage: false, animations: 'disabled', caret: 'hide' });
  await page.getByRole('button', { name: 'Submit claim' }).click();
  await expect(page).toHaveURL(/\/claims\/\d+$/);
  await expect(page.getByText(/per-trip limit/)).toBeVisible();
  await expect(page.getByText(/Possible duplicate/)).toHaveCount(0);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/04-claim-detail-policy-flags.png`, fullPage: false, animations: 'disabled', caret: 'hide' });
  await logout(page);

  await login(page, 'manager');
  await page.goto('/approvals');
  await expect(page.getByRole('heading', { name: 'Approvals inbox' })).toBeVisible();
  await expect(page.getByRole('link', { name: new RegExp(title) }).first()).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/05-approvals-inbox.png`, fullPage: false, animations: 'disabled', caret: 'hide' });

  // Approver flow, Playwright-timed: inbox -> open claim -> receipt visible -> approve confirmed.
  // Automated timings exclude human reading/decision time; the manual stopwatch run is recorded separately.
  const t0 = Date.now();
  await page.getByRole('link', { name: new RegExp(title) }).first().click();
  await expect(page.getByRole('heading', { name: 'Your decision' })).toBeVisible();
  const t1 = Date.now();
  await expect(page.locator('.receipt-frame img')).toBeVisible();
  await expect.poll(() => page.locator('.receipt-frame img').evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(true);
  const t2 = Date.now();
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/06-review-side-by-side.png`, fullPage: false, animations: 'disabled', caret: 'hide' });
  const t3 = Date.now();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByText(/Approved\./)).toBeVisible();
  const t4 = Date.now();
  const timing = {
    label: 'Playwright-timed approver flow (automated; excludes human reading and decision time)',
    run_at: new Date().toISOString(),
    browser: test.info().project.use?.channel || 'chromium',
    steps_ms: {
      open_claim_from_inbox: t1 - t0,
      receipt_rendered_side_by_side: t2 - t1,
      approve_click_to_confirmation: t4 - t3,
    },
    total_ms_excluding_screenshot: (t2 - t0) + (t4 - t3),
  };
  writeFileSync(`${EVIDENCE}/approver-flow-timing.json`, `${JSON.stringify(timing, null, 2)}\n`);
  await test.info().attach('approver-flow-timing', { body: JSON.stringify(timing, null, 2), contentType: 'application/json' });
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
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator(':focus').evaluate((el) => el.blur());
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/07-mobile-claim-capture-390px.png`, fullPage: false, animations: 'disabled', caret: 'hide' });
});

test('E2E-03 auditor queue filters and dashboard charts render', async ({ page }) => {
  await login(page, 'auditor');
  await page.goto('/audit');
  await expect(page.getByRole('heading', { name: 'Audit queue' })).toBeVisible();
  const rows = page.locator('table.data tbody tr');
  await expect(rows.first()).toBeVisible();
  // Select three rows so the evidence shows the bulk-approve bar (nothing is approved here).
  for (let i = 0; i < 3; i++) await rows.nth(i).locator('input[type=checkbox]').check();
  await expect(page.getByRole('region', { name: 'Bulk actions' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Bulk actions' })).toContainText('3');
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/08-audit-queue-bulk.png`, fullPage: false, animations: 'disabled', caret: 'hide' });
  await page.getByRole('region', { name: 'Bulk actions' }).getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('region', { name: 'Bulk actions' })).toHaveCount(0);

  await page.goto('/dashboard');
  await expect(page.locator('.skeleton').first()).toHaveCount(0, { timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'Spend trend' })).toBeVisible();
  await expect(page.locator('.kpi')).toHaveCount(5);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/09-dashboard.png`, fullPage: false, animations: 'disabled', caret: 'hide' });
});

test('E2E-04 head sees payouts and policy configuration', async ({ page }) => {
  await login(page, 'head');
  await page.goto('/payouts');
  await expect(page.getByRole('heading', { name: 'Payouts' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Payout progress' }).locator('.kpi')).toHaveCount(4);
  await expect(page.locator('table.data tbody tr').first()).toBeVisible();   // eligible claims loaded
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/10-payouts.png`, fullPage: false, animations: 'disabled', caret: 'hide' });
  await page.goto('/policy');
  await expect(page.getByText('CAB_TRIP_LIMIT').first()).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/11-policy-config.png`, fullPage: false, animations: 'disabled', caret: 'hide' });
});

test('E2E-05 employee cannot open finance pages', async ({ page }) => {
  await login(page, 'employee');
  await page.goto('/payouts');
  await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible();
  // and the API itself refuses, so hiding the page is not the only control
  const status = await page.evaluate(async () => (await fetch('/api/payouts')).status);
  expect(status).toBe(403);
});
