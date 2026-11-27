---
name: approval-workflow-app
description: Build or review any "request → policy check → multi-level approval → payout/fulfilment" web app (expenses, leave, purchase orders, refunds, access requests) the way Team 01 built ExpenseFlow. Use when a brief has thresholds, approvers, delegation, duplicates or an audit trail.
---

# Approval-workflow app playbook (from ExpenseFlow, AI Manthan Team 01)

Follow these steps in order. Each step is plan-first: propose, wait for the user's approval, then build and verify.

## 1. Find the gaps before any code
Ask the brief these questions and write the answers as numbered decisions (D1..Dn) in `submission/ideation.md`:
- How does a line/item outcome roll up to the request? (worst-wins is simplest)
- Which rule outcomes are reject vs route vs approve? Exact duplicates → reject; "possible" duplicates → route to a human.
- Can a clean request skip humans at ANY size? (No: cap auto-approve at the first human threshold.)
- Thresholds: on the total or per line? strictly greater or ≥?
- Per-day / per-period limits: summed across requests? (Yes, or people split requests.)
- Send-back: does the chain restart? (Yes — edits after approval must be re-approved.)
- Delegation: date-bounded, never to self, delegate can't act on own request, audit "on behalf of".
- Sampling/audit: are sampled items held from payout until cleared? (Yes.)

## 2. Review the design as a skeptical auditor
Prompt: *"Act as a skeptical finance auditor. List every way an employee or approver could bypass approvals or get paid twice in this design, and for each name the server-side control and the automated test that proves it."* Typical holes: self-approval (incl. via delegation), splitting requests under thresholds, editing after approval, acting out of turn, double-click/replay, reusing a receipt, hiding the UI but not the API, editing the audit log, two concurrent submits missing each other's totals.

## 3. Non-negotiable implementation patterns
- Policy rules in a DB config table, read by a **pure** evaluator `evaluate(lines, config, context)`; the context carries facts from other requests. Tests write a config dict, no DB.
- **Tests before the policy engine**: one test per rule at limit and limit + 1 minor unit.
- Money in integer minor units; UTC in DB.
- State transitions as `UPDATE ... WHERE id=? AND status=? AND step IS NOT DISTINCT FROM ?`; 0 rows → 409. Never `SELECT` then `UPDATE`.
- One-batch-per-item via a UNIQUE constraint on the payout item; deterministic export file.
- Append-only audit table enforced by a trigger (UPDATE/DELETE/TRUNCATE raise).
- Advisory lock around submit when rules depend on other requests.
- 404 (not 403) for records the user may not see.

## 4. Test like it matters
- Concurrency tests on the real database (PostgreSQL), not SQLite: N threads + Barrier, assert exactly one success.
- A script that runs the written E2E cases against the live stack and writes a CSV of results.
- Playwright with `channel: 'msedge'` if browser downloads are blocked; 390px overflow check + Tab-reachability check; screenshots double as UI-design evidence.

## 5. SRE drill that finds something real
Metric: age of the oldest pending approval. Seed a healthy baseline (cap seeded ages below the threshold!), inject a stale item, wait for the alert, remediate via delegation (not SQL), verify recovery, and write the RCA from the script output. Ask: "could the responder find the stuck item in the UI?" — ours couldn't; that became the fix.

## Templates in this repo
`CLAUDE.md` (rules + state machine + API contract), `ops/drill.py`, `ops/e2e_cases.py`, `ops/prometheus/alerts.yml`, `submission/claude-usage-journal.md`.
