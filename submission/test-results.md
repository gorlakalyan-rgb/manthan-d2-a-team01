# ExpenseFlow — Test Results (27 Nov 2026)

All results below are from real runs on this laptop against PostgreSQL 18.7 in Docker. Raw evidence is in `submission/test-evidence/`.

## Summary
| Suite | Tool | Result | Evidence |
|---|---|---|---|
| Policy engine unit tests (every rule + boundaries) | pytest | **23 / 23 passed** | `backend/tests/test_policy.py` |
| API / workflow integration (thresholds, delegation, self-approval, concurrency, payouts, audit, policy config, uploads) | pytest on PostgreSQL 18 | **21 / 21 passed** | `backend/tests/test_api.py`, `test-evidence/pytest-junit.xml` |
| **Total backend** | pytest | **44 passed, 0 failed** | `test-evidence/pytest-summary.txt` |
| UI end-to-end (Playwright 1.60; Edge locally, Chromium via `PW_EXECUTABLE` in CI) | Playwright | **5 / 5 passed** (re-run after evidence fixes, reduced motion, 1440 × 900) | `frontend/e2e/expenseflow.spec.js`, `test-evidence/playwright-junit.xml`, `screenshots/` (all 11 regenerated and inspected) |
| 10 written E2E cases (test plan §E2E) | `ops/e2e_cases.py` against live stack | **10 / 10 passed** | `test-evidence/e2e-cases-results.csv` |
| SRE incident drill | `ops/drill.py` | **Alert fired in 60–66 s, resolved in 5 s** | `drill-output.txt`, `incident-rca.md` |
| Security checklist | pip-audit, npm audit, review | **12 / 12 pass** (after 3 fixes) | `security-review.md` |
| Dependency check | pip-audit / npm audit | **No known vulnerabilities** / **0 vulnerabilities** | CI job `backend` + `frontend` |

## Key boundary results (policy engine)
| Rule | At limit | Limit + ₹0.01 |
|---|---|---|
| Meals ₹1,500/day (summed across claims) | Auto-approve | Routed (MEAL_DAILY_LIMIT) |
| Hotel tier-1 ₹6,000/night × 2 | Auto-approve | Routed (HOTEL_NIGHT_LIMIT_TIER1) |
| Hotel other ₹4,000/night | Auto-approve | Routed (HOTEL_NIGHT_LIMIT_OTHER) |
| Cab ₹2,000/trip | Auto-approve | Routed (CAB_TRIP_LIMIT) |
| Receipt above ₹500 | ₹500 without receipt OK | ₹500.01 without receipt → auto-reject |
| Auto-approve cap ₹25,000 | Clean ₹25,000 auto-approves | Clean ₹25,000.01 routed |
| Auditor step > ₹25,000 | ₹25,000 → MANAGER only | ₹25,000.01 → MANAGER, AUDITOR |
| Head step > ₹1,00,000 | ₹1,00,000 → MANAGER, AUDITOR | ₹1,00,000.01 → + HEAD |
| Weekend | Friday clean | Saturday / Sunday routed |

## Concurrency
`test_parallel_approvals_only_one_wins`: 8 manager sessions approve the same claim at the same instant (threading.Barrier) → exactly **one 200**, seven **409 STALE_STATE**. Runs on PostgreSQL (not SQLite) so row locking is real.

## Written E2E cases (test plan)
| ID | Title | Result | Evidence |
|---|---|---|---|
| E2E-01 | Clean small claim auto-approves | PASS | claim → APPROVED, no flags |
| E2E-02 | Missing receipt auto-rejects, fix and resubmit | PASS | AUTO_REJECTED → APPROVED after receipt added |
| E2E-03 | Thinnest slice: routed claim to Paid | PASS | MANAGER → AUDITOR → APPROVED → batch → PAID; CSV amount 28900.00 |
| E2E-04 | Claim above ₹1,00,000 needs head | PASS | at HEAD after auditor; in head inbox; APPROVED after head |
| E2E-05 | Send back restarts the chain | PASS | NEEDS_CLARIFICATION with comment; resubmit → MANAGER |
| E2E-06 | Delegate approves on behalf of manager | PASS | "Arun Auditor on behalf of Maya Manager" in timeline |
| E2E-07 | Manager cannot approve own claim | PASS | not in inbox; no button; API 403 SELF_APPROVAL |
| E2E-08 | Reused receipt is auto-rejected | PASS | AUTO_REJECTED DUPLICATE_RECEIPT_HASH |
| E2E-09 | Auditor filters queue, bulk approves, clears sample | PASS | 3 bulk-approved; sample cleared and payable |
| E2E-10 | Employee sees only own claims; dashboard | PASS | colleague claim 404; KPIs ok |

## UI test cases
| ID | Check | Result | How verified |
|---|---|---|---|
| UI-01 | 390 px: no horizontal scroll on claim capture | PASS | Playwright E2E-02 (`scrollWidth - innerWidth ≤ 0`), `screenshots/07-mobile-claim-capture-390px.png` |
| UI-03 | Review screen: receipt side-by-side with lines and flags | PASS | Playwright E2E-01, `screenshots/06-review-side-by-side.png` |
| UI-04 | Keyboard: Tab reaches "Submit claim" from title | PASS | Playwright E2E-02 |
| UI-07 | Empty / loading / error states present on every data view | PASS (code review + screenshots) | each page uses Loading / Empty / ErrorState components |
| UI-11 | Status chips and flags have text, not colour only | PASS | screenshots 04, 06 |
| UI-12 | Buttons match `allowed_actions` | PASS | E2E-07 (no approve on own claim), Playwright E2E-05 (role guard + API 403) |
| UI-02, 05, 06, 08, 09, 10 | Upload on phone camera, keyboard bulk-select, slow network, 409 message, field-level 422, session expiry | Not executed (time) | Manual follow-up; UI-09 is a known limitation (DEF-12) |

## Approver flow timing (inbox → inspect receipt → approve)
Two separate measurements. They are not interchangeable: the automated one has no human reading time.

**A. Playwright-timed (automated)** — recorded by E2E-01 on 2026-11-27 (chromium), raw data in
[`test-evidence/approver-flow-timing.json`](test-evidence/approver-flow-timing.json).

| Step | Time |
|---|---|
| Open claim from inbox → review screen ready | 369 ms |
| Receipt rendered beside the lines | 131 ms |
| Approve click → "Approved." confirmation | 159 ms |
| **Total (excluding the evidence screenshot)** | **659 ms** |

**B. Manual stopwatch (live, human)** — to be filled in from a real run by a team member.

| Run | Tester | Claim | Inbox → receipt inspected | → Approved | Total | Notes |
|---|---|---|---|---|---|---|
| 1 | _(name)_ | _(#id)_ | _( s)_ | _( s)_ | _( s)_ | |
| 2 | _(name)_ | _(#id)_ | _( s)_ | _( s)_ | _( s)_ | |

How to run B: sign in as `manager@demo.expenseflow.test`, open **Approvals**, start the stopwatch, click the
oldest claim, read the receipt on the right, press **A** (or click Approve), stop when "Approved." appears.

## Defects
12 logged in `defect-log.csv` — 10 fixed, 1 monitoring (cold-start flake), 1 open/accepted (field-level 422 mapping).
