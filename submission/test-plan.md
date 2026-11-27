# ExpenseFlow — Test Plan

**Team 01 · AI Manthan Day 2 · Track A**
Traceability: stories `S01`–`S18` in [stories.xlsx](stories.xlsx) / [stories.csv](stories.csv); bypass controls in [low-level-design.md §12](low-level-design.md).

## 1. Scope

**In scope**
- Policy engine: every rule in `policy_rules`, line and claim outcome aggregation, line validation, sample-audit selection.
- Claim state machine: every row of the CLAUDE.md table, and that every other transition returns 409.
- Approval chain: thresholds, approver resolution, delegation, self-approval, send-back restart.
- API: authentication, CSRF guard, visibility (404), role checks (403), validation (422), error body shape.
- Concurrency of approvals and payout creation.
- Payouts: eligibility, uniqueness, CSV format and byte-identical re-export, mark paid.
- Dashboard numbers on seeded data; audit log append-only; metrics endpoint.
- UI: main flows for all four personas at phone (390 px) and desktop widths, keyboard-only use, loading / empty / error states.
- Basic security checklist (section 9).

**Out of scope**: OCR, multi-currency, real email, real bank integration, load testing beyond a smoke check, browsers other than Chromium.

## 2. Approach

Tests first for the policy engine (brief requirement). Test pyramid:

| Layer | Tool | Location | Needs DB |
|---|---|---|---|
| Unit — policy engine (pure function), step planning | pytest | `backend/tests/test_policy.py` (23 tests) | No |
| API / integration — state machine, thresholds, delegation, payouts, audit log, uploads, directory | pytest + FastAPI TestClient, real PostgreSQL 18 | `backend/tests/test_api.py` (22 tests) | Yes (`TEST_DATABASE_URL`) |
| Concurrency | pytest + `threading.Barrier`, separate sessions | `backend/tests/test_api.py::test_parallel_approvals_only_one_wins` | Yes |
| Written E2E cases (§5) | Python script against the live stack | `ops/e2e_cases.py` → `test-evidence/e2e-cases-results.csv` | Full stack |
| End-to-end UI | Playwright 1.60 (Chromium) | `frontend/e2e/expenseflow.spec.js` | Full stack |
| Security / supply chain | `pip-audit`, `npm audit`, gitleaks, manual checklist | CI + section 9 | — |

> All test names below are the real functions in `backend/tests/`. Where a planned case has no dedicated automated test yet, the cell says **not automated** instead of naming a file that does not exist.

### 2.1 Policy engine unit tests — boundaries

All amounts in paise; "limit" is strictly greater than. All tests are in `backend/tests/test_policy.py`.

| Rule | At limit → expected | Just above → expected | Test name |
|---|---|---|---|
| MEAL_DAILY_LIMIT | ₹1,500.00 (150000) same day → APPROVE | ₹1,500.01 (150001) → ROUTE | `test_meal_at_limit_is_approved`, `test_meal_one_paisa_over_limit_routes` |
| MEAL_DAILY_LIMIT across lines / claims | two lines on different days → APPROVE | ₹1,000 + ₹600 same day (same claim or earlier claim) → ROUTE | `test_meal_limit_sums_lines_in_same_claim_same_day`, `test_meal_limit_counts_other_claims_same_day`, `test_meals_on_different_days_not_summed` (rejected-claim exclusion is in the SQL that builds `PolicyContext`; not automated) |
| HOTEL_NIGHT_LIMIT_TIER1 | Mumbai, 2 nights, ₹12,000 → APPROVE | ₹12,000.01 → ROUTE; " bengaluru " matches tier-1 | `test_hotel_tier1_at_limit_approved`, `test_hotel_tier1_over_limit_routes`, `test_tier1_city_match_is_case_insensitive` |
| HOTEL_NIGHT_LIMIT_OTHER | Indore, 1 night, ₹4,000 → APPROVE | ₹4,500 → ROUTE | `test_hotel_other_city_uses_lower_limit` |
| CAB_TRIP_LIMIT | ₹2,000 → APPROVE | ₹2,000.01 → ROUTE | `test_cab_at_limit_approved_and_over_routes` |
| RECEIPT_REQUIRED_ABOVE | ₹500.00 no receipt → APPROVE | ₹500.01 no receipt → REJECT | `test_no_receipt_at_500_ok`, `test_no_receipt_above_500_rejects` |
| DUPLICATE_RECEIPT_HASH | first use of a hash in a claim → no flag | hash on an earlier claim, or twice in one claim → REJECT | `test_same_receipt_hash_on_earlier_claim_rejects`, `test_same_receipt_hash_twice_in_one_claim_rejects_second` |
| DUPLICATE_VENDOR_AMOUNT_DATE | different amount → no flag | "  UBER " vs "uber", same amount + date (earlier claim or same claim) → ROUTE | `test_vendor_amount_date_duplicate_routes`, `test_vendor_duplicate_inside_same_claim_routes`, `test_different_amount_is_not_duplicate` |
| WEEKEND_SPEND | Friday → APPROVE | Saturday → ROUTE; Sunday → ROUTE | `test_saturday_and_sunday_flagged_friday_not` |
| AUTO_APPROVE_MAX_TOTAL | clean ₹25,000.00 → APPROVE | clean ₹25,000.01 → ROUTE | `test_clean_claim_above_auto_approve_cap_routes` |
| Aggregation | REJECT + ROUTE lines → claim REJECT | — | `test_worst_line_wins_reject_over_route` |
| Config, not code | `CAB_TRIP_LIMIT` 200000 → ₹2,500 routes | change value to 300000 in config → APPROVE | `test_config_change_changes_outcome_without_code_change` (unit), `test_api.py::test_policy_change_by_head_takes_effect_without_code_change` (via API) |
| Approval thresholds | ₹25,000 → MANAGER; ₹1,00,000 → MANAGER, AUDITOR | ₹25,000.01 → + AUDITOR; ₹1,00,000.01 → + HEAD | `test_required_steps_thresholds_strictly_greater` |
| Sample audit | `SAMPLE_AUDIT_PERCENT=0` → never | over 5,000 ids 8–12%; same id → same answer | `test_sampling_is_about_ten_percent_and_deterministic` |
| Line validation | ₹10,00,000, today, 365 days old → valid | 0, > ₹10,00,000, future date, hotel without nights, empty vendor → 422 | not automated (server check in `workflow.py` `INVALID_LINE`; client check in `ClaimEditor.jsx`) |

### 2.2 Approval chain and API tests

All tests are in `backend/tests/test_api.py` unless stated.

| Area | Cases | Tests |
|---|---|---|
| Thresholds | ₹25,000.01 routed → MANAGER→AUDITOR; exactly ₹25,000 clean → auto-approve; ₹1,00,000.01 → MANAGER→AUDITOR→HEAD | `test_25k_needs_manager_only_then_approved`, `test_above_1_lakh_goes_manager_auditor_head`, `test_policy.py::test_required_steps_thresholds_strictly_greater` |
| Missing manager | `manager_id` null → AUDITOR mandatory | not automated (logic in `workflow.plan_steps`) |
| Sole head | head's own claim when no other head → HEAD step skipped and logged | not automated (logic in `workflow.plan_steps`) |
| Self-approval | owner calls approve → 403 `SELF_APPROVAL`; delegate on own claim → 403 | `test_self_approval_blocked`, `test_delegate_cannot_approve_own_claim` |
| Out of turn | auditor approves at MANAGER → 403 | `test_above_1_lakh_goes_manager_auditor_head` |
| Delegation | delegate acts inside window → 200, timeline has `on_behalf_of_name`; delegate to self → 422 | `test_delegation_lets_delegate_act_on_behalf_and_is_audited` |
| Send back | comment required (422); send_back → NEEDS_CLARIFICATION; resubmit → step MANAGER again | `test_send_back_restarts_chain_from_manager` |
| Terminal states | approve or resubmit after REJECTED → 409 | `test_reject_is_terminal` |
| 401 | `/api/claims` without cookie → 401; wrong password → 401 | `test_bad_password_and_csrf` |
| 403 | non-GET without `X-Requested-With` → 403; employee on payouts / dashboard / policy → 403; employee on oversight queue / directory → 403 | `test_bad_password_and_csrf`, `test_employee_cannot_use_head_endpoints`, `test_oversight_queue_shows_stale_claims_at_any_step`, `test_employee_directory_scoping` |
| 404 | employee GET / PUT on another employee's claim → 404; manager opens employee outside own reporting line → 404 | `test_employee_sees_only_own_claims`, `test_employee_directory_scoping` |
| 415 | HTML file renamed `.png` → 415 | `test_upload_rejects_non_receipt_files` |
| Oversight queue | `kind=all_pending` lists a claim stuck at MANAGER that `kind=all` does not | `test_oversight_queue_shows_stale_claims_at_any_step` |
| Employee directory | head/auditor see everyone with bank details; managers see their reporting tree without bank details; employee → 403 | `test_employee_directory_scoping` |
| Bulk | mix of valid and wrong-step ids → per-item results | not automated in pytest (covered by E2E-09 in `ops/e2e_cases.py`) |

### 2.3 Concurrency

`test_api.py::test_parallel_approvals_only_one_wins`: 8 manager sessions approve the same claim behind a `threading.Barrier`. Expect exactly one 200 and seven 409. Runs on PostgreSQL, so row locking is real. Submit-time races (meal totals, duplicate hashes) are prevented by the global `pg_advisory_xact_lock(424242)` in `workflow.submit` (LLD §9); there is no dedicated race test for submit.

### 2.4 Payout duplicate prevention

| Case | Expected | Test |
|---|---|---|
| Same claim in two `POST /api/payouts` calls | second → 409 | `test_payout_batch_csv_and_no_double_payment` |
| Duplicate `payout_items.claim_id` at DB level | unique violation | `UNIQUE` constraint in `schema.sql`; no dedicated test |
| SAMPLE_AUDIT claim | POST → 409 | `test_sample_audit_claims_not_payable_until_cleared` |
| Mark paid twice | second → 409; claim → PAID | `test_payout_batch_csv_and_no_double_payment` |
| CSV | header starts `batch_id,line_no,`, 2-decimal amounts, re-export byte-identical | `test_payout_batch_csv_and_no_double_payment` |

## 3. Environments

| Env | What | Data |
|---|---|---|
| Dev | `npm run dev` (:5173) + backend on :8080 | seed |
| Test (CI) | GitHub Actions: PostgreSQL 18 service container, `pytest -q`, `pip-audit`, `npm audit`, Playwright against `docker compose up --wait` | fresh seed per run (fixed random seed) |
| Demo | `docker compose up -d --build --wait`: app :8080, Prometheus :9090, Grafana :3000 | 150 employees, 8 departments, 3,000 historical claims with planted duplicates and limit breaches |

Synthetic data only; every seeded user's password is `demo123`.

## 4. Entry and exit criteria

**Entry**: schema and seed load cleanly; `/healthz` returns `{"status":"ok","db":"ok"}`; policy unit tests exist before the engine (tests-first); CLAUDE.md contract frozen for the slice under test.

**Exit**
- 100% of policy unit tests pass, with a boundary test per rule.
- All API, concurrency and payout tests pass; every row of the bypass table has a passing test.
- All 10 end-to-end cases pass on the Docker demo.
- No Critical/High findings from `pip-audit` / `npm audit` that are unaddressed or unexplained.
- Security checklist reviewed, every row has a status.
- Open defects: none Critical; any Major has a written workaround.

## 5. End-to-end test cases

| ID | Title | Persona | Preconditions | Steps | Expected result | Result (`ops/e2e_cases.py`, `test-evidence/e2e-cases-results.csv`) |
|---|---|---|---|---|---|---|
| E2E-01 | Clean small claim auto-approves | Employee | Logged in as seeded employee with a manager; no meals today | 1. New claim "Stationery". 2. Add office_supplies ₹450, today (weekday), vendor, no receipt. 3. Save draft. 4. Submit. | Status APPROVED (or SAMPLE_AUDIT if sampled); no reasons; timeline shows submit | PASS — claim 3007 → APPROVED, no flags |
| E2E-02 | Missing receipt auto-rejects, fix and resubmit | Employee | Logged in | 1. Claim with local_cab ₹720, no receipt. 2. Submit. 3. Upload a PDF receipt to the line. 4. Resubmit. | Step 2: AUTO_REJECTED with "Receipt required..." reason. Step 4: no REJECT reason; claim leaves AUTO_REJECTED | PASS — claim 3008 AUTO_REJECTED → APPROVED after receipt added |
| E2E-03 | Thinnest slice: routed claim to Paid | Employee, manager, auditor, head | Seeded users; employee's manager known | 1. Employee: 2-line claim, hotel Pune 4 nights ₹28,000 + meal ₹900 (weekday), receipts, total ₹28,900 → submit. 2. Manager approves from inbox. 3. Auditor approves. 4. Head adds to payout batch, downloads CSV, marks paid. | Hotel line flagged HOTEL_NIGHT_LIMIT_TIER1; steps MANAGER → AUDITOR → APPROVED; CSV row with amount_inr in 2 decimals; claim PAID; timeline lists every actor | PASS — claim 3009 MANAGER → AUDITOR → APPROVED → batch 27 → PAID; CSV 28900.00 |
| E2E-04 | Claim above ₹1,00,000 needs head | Employee, manager, auditor, head | Logged in | 1. Submit ₹1,20,000 airfare claim with receipt. 2. Manager approves. 3. Auditor approves. 4. Head approves. | After step 3 the claim is at HEAD and appears in the head's inbox, not APPROVED; after step 4 APPROVED | PASS — claim 3010 at HEAD after auditor, in head inbox, APPROVED after head |
| E2E-05 | Send back restarts the chain | Employee, manager, auditor | ₹30,000 routed claim at AUDITOR step | 1. Auditor: send back with comment. 2. Employee edits a line, resubmits. | NEEDS_CLARIFICATION with comment visible; after resubmit current_step = MANAGER | PASS — claim 3011 NEEDS_CLARIFICATION; resubmit restarts at MANAGER |
| E2E-06 | Delegate approves on behalf of manager | Manager, delegate, employee | Manager sets delegation (today → +5 days) to a peer | 1. Employee submits routed claim. 2. Delegate logs in, opens inbox, approves. | Claim in delegate's inbox; timeline reads "approved by <delegate> on behalf of <manager>" | PASS — claim 3012 "Arun Auditor on behalf of Maya Manager" |
| E2E-07 | Manager cannot approve own claim | Manager | Manager logged in | 1. Manager submits own routed claim. 2. Opens the claim and the inbox. 3. Calls POST /actions approve via devtools/fetch. | Claim not in own inbox; no Approve button; API returns 403 | PASS — claim 3013 not in own inbox, no approve action, API 403 SELF_APPROVAL |
| E2E-08 | Reused receipt is auto-rejected | Employee | Receipt file already used on a non-rejected claim | 1. New claim, upload the same file. 2. Submit. | AUTO_REJECTED with DUPLICATE_RECEIPT_HASH reason | PASS — claim 3015 AUTO_REJECTED DUPLICATE_RECEIPT_HASH |
| E2E-09 | Auditor filters queue and bulk approves | Auditor | Several seeded claims at AUDITOR step and in SAMPLE_AUDIT | 1. Open audit queue, kind=auditor_step, filter department + flag. 2. Select 3 rows, bulk approve with comment. 3. Switch to kind=sample_audit, clear one. | Filters narrow the list; bulk shows per-claim result; cleared sample claim becomes APPROVED and appears in payouts eligible | PASS — filtered queue 4 rows; bulk approved 3016–3018; sample 508 cleared and payable |
| E2E-10 | Employee sees only own claims; dashboard for finance | Employee, head | Seeded data | 1. Employee: My claims; try `/claims/<colleague id>` URL. 2. Head: open dashboard. | Employee sees only own claims; colleague URL shows "not found"; dashboard shows KPIs, spend by category/department/month, violations by rule, avg approval time | PASS — 187 own claims only; colleague claim 404; dashboard KPIs ok |

## 6. UI test cases

| ID | Area | Case | Expected | Result (from test-results.md) |
|---|---|---|---|---|
| UI-01 | 390 px phone | Login, My claims, claim editor, claim detail at 390 × 844 | No horizontal scroll; tap targets ≥ 44 px; line items stack as cards; amounts in en-IN (₹1,50,000.00) | PASS — Playwright (`scrollWidth − innerWidth ≤ 0` at 390 px), `screenshots/07-mobile-claim-capture-390px.png` |
| UI-02 | 390 px phone | Upload receipt from phone (file input with camera) | Upload progress, then filename and size shown; error message for > 5 MB | Not executed (time) — manual follow-up |
| UI-03 | 390 px phone | Approval inbox and receipt viewer | Receipt opens full-width; Approve / Send back / Reject reachable without zoom | PASS — Playwright E2E-01, `screenshots/06-review-side-by-side.png` |
| UI-04 | Keyboard only | Log in, create claim, add 2 lines, submit, using Tab / Shift+Tab / Enter / Space only | Visible focus ring on every control; logical order; no traps; dialogs close on Esc and return focus | PASS (partial) — Playwright E2E-02: Tab reaches "Submit claim" from the title field |
| UI-05 | Keyboard only | Manager approves from inbox; auditor bulk-selects with keyboard | Checkboxes and actions reachable; confirmation dialog announces result | Not executed (time) — manual follow-up |
| UI-06 | Loading | Slow network (Playwright route delay 2 s) on inbox, claim detail, dashboard | Skeleton / spinner shown; buttons disabled while submitting (no double submit) | Not executed (time) — manual follow-up |
| UI-07 | Empty | New employee with no claims; manager with empty inbox; audit queue with filters matching nothing | Friendly empty message with next action ("Create your first claim") | PASS — code review + screenshots (every data view uses Loading / Empty / ErrorState) |
| UI-08 | Error | API returns 409 (someone else acted first) on approve | Message "This claim was already actioned"; detail refreshes to the new state | Not executed (time) — manual follow-up |
| UI-09 | Error | API 422 on save (future date) | Field-level message next to the line; data entered is kept | Not executed (time). Client-side future-date check shows next to the field (`ClaimEditor.jsx:60`); see DEF-12 |
| UI-10 | Error | Session expired (401) | Redirect to login with a message; after login return to the page | Not executed (time) — manual follow-up |
| UI-11 | Accessibility | Status chips and policy flags | Text label, not colour only; contrast ≥ 4.5:1; form fields have labels | PASS — screenshots 04, 06 (text labels on chips and flags) |
| UI-12 | Allowed actions | Buttons match `allowed_actions` for each persona and state | No button offered that the API would reject | PASS — E2E-07 (no approve on own claim), Playwright E2E-05 (role guard + API 403) |

## 7. Defect handling

Severity: Critical (bypass, wrong payout, data leak), Major (flow blocked), Minor (cosmetic). A Critical blocks the demo build until fixed and covered by a regression test.

## 8. Metrics and monitoring checks

`/metrics` exposes the five metric families in CLAUDE.md; after E2E-03, `expenseflow_claim_transitions_total{to_status="PAID"}` has increased; Grafana panels show queue size and oldest pending hours.

## 9. Security checklist (OWASP Top 10 style)

| # | Area | Check | How verified | Status (from security-review.md) |
|---|---|---|---|---|
| SEC-01 | Broken access control | Employee cannot read/act on others' claims (404); role matrix for every endpoint; no self-approval incl. delegation | `test_employee_sees_only_own_claims`, `test_employee_cannot_use_head_endpoints`, `test_self_approval_blocked`, `test_delegate_cannot_approve_own_claim`, `test_employee_directory_scoping`, E2E-07, E2E-10 | PASS |
| SEC-02 | Broken access control | Receipts served only to uploader or viewers of a claim using them | Code review of `GET /api/receipts/{id}` in `main.py` (404 otherwise); no dedicated test | PASS |
| SEC-03 | Injection | All SQL parameterised; queue filters cannot inject (e.g. `q=' OR 1=1--`) | Code review: f-strings in SQL use constants only, user input via `%s`; no dedicated injection test | PASS |
| SEC-04 | Authentication / session | Password hashed; cookie HttpOnly, SameSite=Lax, signed; tampered cookie → 401; logout clears it | `backend/app/auth.py` review, `test_bad_password_and_csrf`. Demo persona picker: see security-review.md SEC-04 note | PASS (accepted risks F3, F5) |
| SEC-05 | CSRF | Non-GET without `X-Requested-With: ExpenseFlow` → 403 | `test_bad_password_and_csrf` | PASS |
| SEC-06 | File upload | Only JPG/PNG/PDF by magic bytes; ≤ 5 MB; renamed on disk; `nosniff`; `.html` renamed `.png` rejected | `test_upload_rejects_non_receipt_files` (HTML renamed `.png` → 415) | PASS |
| SEC-07 | Secrets | `SESSION_SECRET`, DB password from env; none in repo, logs or images | `git grep` for key/secret/password/token; gitleaks in CI | PASS |
| SEC-08 | Vulnerable dependencies | `pip-audit` and `npm audit` in CI | `pip-audit` / `npm audit` (CI job) | PASS after fix (DEF-07, DEF-08) |
| SEC-09 | Logging and audit | Every transition, delegation, policy edit, payout logged; audit_log UPDATE/DELETE raises; no secrets or cookies in logs | `test_audit_log_is_append_only` (UPDATE and DELETE raise) | PASS |
| SEC-10 | Data protection | Synthetic data only; no real PII | `backend/app/seed.py` review | PASS |
| SEC-11 | Security misconfiguration | Debug off in Docker; error responses do not leak stack traces | `curl -I` header check; `{detail, code}` error bodies; no dedicated test | PASS after fix (DEF-09) |
| SEC-12 | Integrity | Payout CSV deterministic; claim paid at most once | `test_payout_batch_csv_and_no_double_payment`; `payout_items.claim_id UNIQUE` | PASS |
