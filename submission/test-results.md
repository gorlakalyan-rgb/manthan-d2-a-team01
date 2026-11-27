# ExpenseFlow — Test Results (27 Nov 2026)

All results below are from real runs. Unless stated otherwise they ran on a team laptop against PostgreSQL 18.7 in Docker. The 27 Nov evening re-run (after PR #3 added a test) and the Locust load test ran in a cloud sandbox where the PostgreSQL 18 image could not be downloaded, so they used PostgreSQL 16.15; this is labelled on each row. Raw evidence is in `submission/test-evidence/`.

## Summary
| Suite | Tool | Result | Evidence |
|---|---|---|---|
| Policy engine unit tests (every rule + boundaries) | pytest | **23 / 23 passed** | `backend/tests/test_policy.py` |
| API / workflow integration (thresholds, delegation, self-approval, concurrency, payouts, audit, policy config, uploads, oversight queue, employee directory, sign-in role, password reset) | pytest on PostgreSQL 18 | **23 / 23 passed** | `backend/tests/test_api.py`, `test-evidence/pytest-junit.xml` |
| **Total backend — latest** | pytest on PostgreSQL 18 | **46 passed, 0 failed** (incl. employee directory scoping, sign-in role check and password reset) | `test-evidence/pytest-summary.txt` |
| Total backend — earlier run (commit `ce25df1`, before sign-in/password-reset tests) | pytest on PostgreSQL 16.15 (sandbox) | 45 passed, 0 failed | `test-evidence/pytest-summary-pg16-sandbox.txt`, `test-evidence/pytest-junit-pg16-sandbox.xml` |
| UI end-to-end (Playwright 1.60; Edge locally, Chromium via `PW_EXECUTABLE` in CI) | Playwright | **5 / 5 passed** (re-run after evidence fixes, reduced motion, 1440 × 900) | `frontend/e2e/expenseflow.spec.js`, `test-evidence/playwright-junit.xml`, `screenshots/` (all 11 regenerated and inspected) |
| 10 written E2E cases (test plan §E2E) | `ops/e2e_cases.py` against live stack | **10 / 10 passed** | `test-evidence/e2e-cases-results.csv` |
| SRE incident drill | `ops/drill.py` | **Alert fired in 60–66 s, resolved in 5 s** | `drill-output.txt`, `incident-rca.md` |
| Security checklist | pip-audit, npm audit, review | **12 / 12 pass** (after 3 fixes) | `security-review.md` |
| Performance (load) | Locust, 20 users, 20 s, PostgreSQL 16.15 (sandbox) | **386 requests, 0 failures, 19.3 req/s, p95 43 ms** | `ops/locustfile.py`, `locust-stats.csv`, `test-evidence/locust-console.txt` |
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

## Performance test (Locust)
Script: [`ops/locustfile.py`](../ops/locustfile.py). 20 simulated users (10 employees, 10 finance head/auditor), ramp 5 users/s, 20 s, wait 0.5–1.5 s between requests. Each user logs in once, then loops over read endpoints: My claims, dashboard, review queue (`kind=all`) and oversight queue (`kind=all_pending`). The run does not create or approve claims.

Environment (27 Nov 2026, 18:05 IST): cloud sandbox, 2 vCPU; app run as in the Dockerfile (`uvicorn --workers 2`) on `http://localhost:8080`; PostgreSQL 16.15 seeded with 150 employees / 3,000 claims. Not the Docker PG 18.7 stack — PG18 could not be downloaded in the sandbox — so absolute numbers are indicative; re-run on the compose stack with the command in the script header.

| Endpoint | Requests | Failures | Median | p95 | Max | req/s |
|---|---|---|---|---|---|---|
| `POST /api/auth/login` | 20 | 0 | 48 ms | 64 ms | 64 ms | 1.00 |
| `GET /api/claims` | 211 | 0 | 18 ms | 34 ms | 67 ms | 10.57 |
| `GET /api/dashboard` | 65 | 0 | 24 ms | 41 ms | 52 ms | 3.26 |
| `GET /api/audit/queue?kind=all` | 57 | 0 | 16 ms | 29 ms | 40 ms | 2.86 |
| `GET /api/audit/queue?kind=all_pending` | 33 | 0 | 16 ms | 43 ms | 45 ms | 1.65 |
| **All** | **386** | **0 (0.00%)** | **19 ms** | **43 ms** | **67 ms** | **19.34** |

Source: final console summary in `test-evidence/locust-console.txt`. `locust-stats.csv` is Locust's own CSV from the same run; Locust writes it every 2 s, so its counts (367 requests) stop at the last flush before shutdown, while its rates and percentiles agree with the console. Login is the slowest call because of PBKDF2 hashing, by design.

## Approver flow timing (inbox → inspect receipt → approve)
Two separate measurements. They are not interchangeable: the automated one has no human reading time.

**A. Playwright-timed (automated)** — recorded by E2E-01 on 2026-11-27 (chromium), raw data in
[`test-evidence/approver-flow-timing.json`](test-evidence/approver-flow-timing.json).

| Step | Time |
|---|---|
| Open claim from inbox → review screen ready | 373 ms |
| Receipt rendered beside the lines | 84 ms |
| Approve click → "Approved." confirmation | 140 ms |
| **Total (excluding the evidence screenshot)** | **597 ms** |

**B. Manual stopwatch (live, human)** — to be filled in from a real run by a team member.

| Run | Tester | Claim | Inbox → receipt inspected | → Approved | Total | Notes |
|---|---|---|---|---|---|---|
| 1 | _(name)_ | _(#id)_ | _( s)_ | _( s)_ | _( s)_ | |
| 2 | _(name)_ | _(#id)_ | _( s)_ | _( s)_ | _( s)_ | |

How to run B: sign in as `manager@demo.expenseflow.test`, open **Approvals**, start the stopwatch, click the
oldest claim, read the receipt on the right, press **A** (or click Approve), stop when "Approved." appears.

## Defects
12 logged in `defect-log.csv` — 10 fixed, 1 monitoring (cold-start flake), 1 partly fixed (DEF-12: client-side and FastAPI-422 errors show next to the field; server `INVALID_LINE` string errors still show at form level).
