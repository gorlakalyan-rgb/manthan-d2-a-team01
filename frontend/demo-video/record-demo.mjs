// Records a ~60s captioned walkthrough of ExpenseFlow (live stack on :8080, Grafana on :3000).
// Usage: node demo-video/record-demo.mjs <outDir>
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'demo-video/out';
const DUR = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));   // narration seconds per segment
const marks = [];
let t0 = 0, segStart = 0;
const mark = (i) => { segStart = Date.now(); marks.push((segStart - t0) / 1000); };
const hold = async (i) => { const left = DUR[i] * 1000 + 600 - (Date.now() - segStart); if (left > 0) await wait(left); };
const BASE = 'http://localhost:8080';
fs.mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function caption(page, text, sub = '') {
  await page.evaluate(([t, s]) => {
    let el = document.getElementById('__demo_caption');
    if (!el) {
      el = document.createElement('div');
      el.id = '__demo_caption';
      el.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483647;' +
        'max-width:1000px;padding:14px 26px;border-radius:14px;background:rgba(10,32,26,.92);color:#fff;' +
        'font:600 22px/1.35 system-ui,Segoe UI,sans-serif;text-align:center;box-shadow:0 10px 30px rgba(0,0,0,.35);pointer-events:none';
      document.body.appendChild(el);
    }
    el.innerHTML = t + (s ? `<div style="font-weight:400;font-size:16px;opacity:.85;margin-top:4px">${s}</div>` : '');
  }, [text, sub]);
}

async function card(page, title, lines) {
  await page.setContent(`<html><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(135deg,#0d3b2e,#145a45);font-family:Segoe UI,system-ui,sans-serif;color:#fff">
    <div style="text-align:center"><div style="font-size:58px;font-weight:700;letter-spacing:-1px">${title}</div>
    ${lines.map((l, i) => `<div style="font-size:${i ? 22 : 28}px;opacity:${i ? .85 : 1};margin-top:${i ? 10 : 18}px">${l}</div>`).join('')}
    </div></body></html>`);
}

async function login(page, who) {
  const out = page.getByRole('button', { name: 'Log out' });
  if (await out.count()) { await out.first().click(); await page.getByRole('heading', { name: 'Sign in' }).waitFor(); }
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill(`${who}@demo.expenseflow.test`);
  await page.getByLabel('Password', { exact: true }).fill('demo123');
  const role = { employee: 'Employee', employee2: 'Employee', manager: 'Manager', auditor: 'Finance auditor', head: 'Finance head' }[who];
  await page.getByRole('radio', { name: role, exact: true }).click();
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: 'Log out' }).waitFor();
}

function lastWeekday(back = 2) {
  const d = new Date(); d.setDate(d.getDate() - back);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

const browser = await chromium.launch({ channel: 'msedge' });

// Receipt image rendered first (not recorded).
const prep = await browser.newPage();
await prep.setContent(`<div style="font:16px monospace;width:320px;padding:20px;background:#fffdf7;border:1px solid #999">
  <b>UBER (SYNTHETIC)</b><br>Trip: Koramangala → MG Road<br>Date: ${lastWeekday()}<br>Ride id: ${Date.now()}<br><br>
  <b style="font-size:22px">TOTAL ₹2,600.00</b><br><small>demo data only</small></div>`);
const receipt = await prep.locator('div').first().screenshot();
await prep.close();

const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: OUT, size: { width: 1280, height: 720 } } });
const page = await ctx.newPage();
t0 = Date.now();
const title = `Client visit cab ${String(Date.now()).slice(-4)}`;

// 0–5s  title
await card(page, 'ExpenseFlow', ['Expense claims with policy-driven approvals', 'AI Manthan · Team 01 · Track A · built with Claude']);
mark(0); await hold(0);

// 5–20s  employee files a claim
await login(page, 'employee');
await page.goto(`${BASE}/claims/new`);
await caption(page, '1 · Employee files a claim', 'Mobile-friendly capture: line items, receipt upload, draft or submit'); mark(1);
await page.getByLabel('Claim title').fill(title);
await page.getByLabel('Category').first().selectOption('local_cab');
await page.getByLabel('Amount (₹)').first().fill('2600');
await page.getByLabel('Date').first().fill(lastWeekday());
await page.getByLabel('Vendor').first().fill('Uber');
await page.locator('input[type=file]').first().setInputFiles({ name: 'uber-receipt.png', mimeType: 'image/png', buffer: receipt });
await hold(1);
await page.getByRole('button', { name: 'Submit claim' }).click();
await page.getByText(/per-trip limit/).first().waitFor();
await caption(page, '2 · Policy engine checks every line', '₹2,600 cab is above the ₹2,000 per-trip limit → routed to the manager (rules are configuration, not code)'); mark(2);
await hold(2);

// 20–33s  manager reviews side by side
await login(page, 'manager');
await page.goto(`${BASE}/approvals`);
await caption(page, '3 · Manager approval inbox', 'Oldest first, with policy flags and age'); mark(3);
await hold(3);
await page.getByRole('link', { name: new RegExp(title) }).first().click();
await page.getByRole('heading', { name: 'Your decision' }).waitFor();
await caption(page, '4 · Receipt side by side with the flagged line', 'Approve · send back · reject — every action is written to an append-only audit trail'); mark(4);
await wait(3500);
await page.getByRole('button', { name: 'Approve', exact: true }).click();
await hold(4);

// 33–45s  finance head: dashboard + payouts
await login(page, 'head');
await page.goto(`${BASE}/dashboard`);
await page.locator('.skeleton').first().waitFor({ state: 'detached', timeout: 15000 }).catch(() => {});
await caption(page, '5 · Finance dashboard', 'Spend by category, department and month · violations · approval time · 48 h / 72 h SLA'); mark(5);
await hold(5);
await page.goto(`${BASE}/payouts`);
await caption(page, '6 · Payout batches', 'Approved claims → mock bank CSV → Paid. A claim can never be paid twice'); mark(6);
await hold(6);

// 45–54s  operations
await page.goto('http://localhost:3000/d/expenseflow-ops?orgId=1&kiosk');
await wait(2500);
await caption(page, '7 · Operations: Prometheus + Grafana', 'Queue size, oldest pending approval, latency · 2-tier alerts · runbook + drilled RCA'); mark(7);
await hold(7);

// 54–60s  close
await card(page, 'ExpenseFlow', ['One command: docker compose up', '44 backend tests · 10/10 E2E cases · 12/12 security checks · SRE drill with RCA', 'Synthetic data only · open-source stack']);
mark(8); await hold(8); await wait(800);

const video = page.video();
await ctx.close();
const src = await video.path();
const dest = path.join(OUT, 'ExpenseFlow-demo-1min.webm');
fs.renameSync(src, dest);
await browser.close();
fs.writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify(marks));
console.log('saved', dest, 'marks', marks.map((m) => m.toFixed(1)).join(','), 'total', ((Date.now() - t0) / 1000).toFixed(1));
