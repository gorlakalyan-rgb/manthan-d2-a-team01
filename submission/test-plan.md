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
| Unit — policy engine (pure function) | pytest | `backend/tests/test_policy.py` | No |
| Unit — state table, step planning | pytest | `backend/tests/test_workflow.py` | No (planning) / Yes (transitions) |
| API / integration | pytest + FastAPI TestClient, real PostgreSQL 18 | `backend/tests/test_api_*.py`, `test_delegation.py`, `test_approvals.py`, `test_payouts.py`, `test_audit_log.py` | Yes (`DATABASE_URL`) |
| Concurrency | pytest + threads, two connections | `backend/tests/test_concurrency.py` | Yes |
| End-to-end UI | Playwright 1.60 (Chromium) | `frontend/e2e/*.spec.ts` | Full stack |
| Security / supply chain | `pip-audit`, `npm audit`, manual checklist | CI + section 9 | — |

### 2.1 Policy engine unit tests — boundaries

All amounts in paise; "limit" is strictly greater than.

| Rule | At limit → expected | Just above → expected | Test name |
|---|---|---|---|
| MEAL_DAILY_LIMIT | ₹1,500.00 (150000) same day → APPROVE | ₹1,500.01 (150001) → ROUTE | `test_meal_limit_boundary` |
| MEAL_DAILY_LIMIT across claims | ₹1,000 existing + ₹500 new → APPROVE | ₹1,000 existing + ₹500.01 new → ROUTE; rejected claims not counted | `test_meal_limit_sums_across_claims`, `test_meal_limit_ignores_rejected_claims` |
| HOTEL_NIGHT_LIMIT_TIER1 | Mumbai, 2 nights, ₹12,000 → APPROVE | ₹12,000.01 → ROUTE; " mumbai " matches tier-1 | `test_hotel_tier1_boundary`, `test_tier1_city_case_insensitive` |
| HOTEL_NIGHT_LIMIT_OTHER | Mysuru, 2 nights, ₹8,000 → APPROVE | ₹8,000.01 → ROUTE; same amount in Mumbai → APPROVE | `test_hotel_other_city_boundary`, `test_tier1_vs_other_city_same_amount` |
| CAB_TRIP_LIMIT | ₹2,000 → APPROVE | ₹2,000.01 → ROUTE | `test_cab_limit_boundary` |
| RECEIPT_REQUIRED_ABOVE | ₹500.00 no receipt → APPROVE | ₹500.01 no receipt → REJECT; with receipt → APPROVE | `test_receipt_required_boundary` |
| DUPLICATE_RECEIPT_HASH | hash only on a rejected claim → no flag | hash on another non-rejected line → REJECT | `test_duplicate_receipt_hash_rejects` |
| DUPLICATE_VENDOR_AMOUNT_DATE | different date or amount → no flag | "Uber " vs "uber", same amount + date → ROUTE | `test_vendor_amount_date_duplicate_routes` |
| WEEKEND_SPEND | Friday → APPROVE | Saturday → ROUTE; Sunday → ROUTE | `test_weekend_saturday_sunday_friday` |
| AUTO_APPROVE_MAX_TOTAL | clean ₹25,000.00 → APPROVE | clean ₹25,000.01 → ROUTE | `test_clean_claim_above_25000_routes` |
| Aggregation | REJECT + ROUTE lines → claim REJECT; ROUTE + APPROVE → ROUTE | — | `test_worst_outcome_wins` |
| Config, not code | value 150000 → ROUTE at 160000 | change value to 200000 in rules → APPROVE | `test_rules_read_from_config` |
| Sample audit | `SAMPLE_AUDIT_PERCENT=0` → never; `100` → always | over 10,000 ids ≈ 10% (±1.5%); same id → same answer | `test_sample_audit_deterministic_and_rate` |
| Line validation | ₹10,00,000 (100000000 paise), today, 365 days old → valid | 0, > 100000000, tomorrow, 366 days old, hotel without nights, empty vendor → invalid | `test_line_validation_boundaries` |

### 2.2 Approval chain and API tests

| Area | Cases | Tests |
|---|---|---|
| Thresholds | ₹25,000.00 routed → MANAGER only; ₹25,000.01 → MANAGER→AUDITOR; ₹1,00,000.00 → MANAGER→AUDITOR; ₹1,00,000.01 → MANAGER→AUDITOR→HEAD | `test_workflow.py::test_step_plan_thresholds` |
| Missing manager | `manager_id` null or self → AUDITOR mandatory even for ₹2,000 | `test_missing_manager_makes_auditor_mandatory` |
| Sole head | head files ₹2 lakh → (MANAGER if any) → AUDITOR, HEAD skipped, `head_step_skipped_self` logged | `test_sole_head_claim_skips_head_logs_event` |
| Self-approval | owner calls approve → 403 `SELF_APPROVAL` | `test_owner_cannot_approve_own_claim` |
| Out of turn | auditor approves at MANAGER → 403 | `test_auditor_cannot_act_at_manager_step` |
| Delegation | delegate acts inside window → 200, timeline has `on_behalf_of_id`; before start / after end → 403; first and last day inclusive; delegate on own claim → 403; delegate to self → 422 | `test_delegation.py::*` |
| Send back | send_back → NEEDS_CLARIFICATION; edit + resubmit → step MANAGER again, even if previously at HEAD | `test_resubmit_restarts_chain_from_manager` |
| 401 | every `/api` endpoint except login, demo-users without cookie → 401 | `test_api_security.py::test_requires_login` |
| 403 | non-GET without `X-Requested-With` → 403; employee on payouts / dashboard / audit queue → 403 | `test_post_without_csrf_header_is_403`, `test_role_matrix` |
| 404 | employee GET other's claim / receipt → 404 | `test_employee_cannot_see_other_claim_404` |
| 409 | edit after submit; clear on PENDING_APPROVAL; approve on APPROVED; replay | `test_edit_after_submit_is_409`, `test_forbidden_transitions_409` (parametrised over the whole state × action grid) |
| 422 | invalid lines, bad file type, file > 5 MB | `test_api_claims.py::test_validation_422`, `test_api_receipts.py::*` |
| Bulk | mix of valid and wrong-step ids → per-item results | `test_bulk_approve_reports_per_item_errors` |

### 2.3 Concurrency

`test_concurrency.py::test_double_approve_only_one_wins`: two threads with separate connections (manager and their delegate) approve the same claim behind a barrier. Expect exactly one 200 and one 409, one audit row, `current_step` advanced once. Repeat 20 times. Also `test_bulk_and_single_approve_race`.

### 2.4 Payout duplicate prevention

| Case | Expected | Test |
|---|---|---|
| Same claim in two `POST /api/payouts` calls | second → 409, nothing created | `test_claim_cannot_be_in_two_batches` |
| Direct DB insert of duplicate `payout_items.claim_id` | unique violation | `test_payout_items_claim_unique_constraint` |
| Batch with one non-APPROVED claim | 409, no claim moved | `test_batch_is_atomic` |
| SAMPLE_AUDIT claim | not in eligible list; POST → 409 | `test_sample_audit_claim_not_eligible` |
| Mark paid twice | second → 409 | `test_mark_paid_twice_is_409` |
| CSV | exact header, 2-decimal amounts, re-export byte-identical | `test_csv_format_and_reexport_identical` |

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

| ID | Title | Persona | Preconditions | Steps | Expected result | Result |
|---|---|---|---|---|---|---|
| E2E-01 | Clean small claim auto-approves | Employee | Logged in as seeded employee with a manager; no meals today | 1. New claim "Stationery". 2. Add office_supplies ₹450, today (weekday), vendor, no receipt. 3. Save draft. 4. Submit. | Status APPROVED (or SAMPLE_AUDIT if sampled); no reasons; timeline shows submit | TBD |
| E2E-02 | Missing receipt auto-rejects, fix and resubmit | Employee | Logged in | 1. Claim with local_cab ₹720, no receipt. 2. Submit. 3. Upload a PDF receipt to the line. 4. Resubmit. | Step 2: AUTO_REJECTED with "Receipt required..." reason. Step 4: no REJECT reason; claim leaves AUTO_REJECTED | TBD |
| E2E-03 | Thinnest slice: routed claim to Paid | Employee, manager, auditor, head | Seeded users; employee's manager known | 1. Employee: 2-line claim, hotel Pune 4 nights ₹28,000 + meal ₹900 (weekday), receipts, total ₹28,900 → submit. 2. Manager approves from inbox. 3. Auditor approves. 4. Head adds to payout batch, downloads CSV, marks paid. | Hotel line flagged HOTEL_NIGHT_LIMIT_TIER1; steps MANAGER → AUDITOR → APPROVED; CSV row with amount_inr in 2 decimals; claim PAID; timeline lists every actor | TBD |
| E2E-04 | Claim above ₹1,00,000 needs head | Employee, manager, auditor, head | Logged in | 1. Submit ₹1,20,000 airfare claim with receipt. 2. Manager approves. 3. Auditor approves. 4. Head approves. | After step 3 the claim is at HEAD and appears in the head's inbox, not APPROVED; after step 4 APPROVED | TBD |
| E2E-05 | Send back restarts the chain | Employee, manager, auditor | ₹30,000 routed claim at AUDITOR step | 1. Auditor: send back with comment. 2. Employee edits a line, resubmits. | NEEDS_CLARIFICATION with comment visible; after resubmit current_step = MANAGER | TBD |
| E2E-06 | Delegate approves on behalf of manager | Manager, delegate, employee | Manager sets delegation (today → +5 days) to a peer | 1. Employee submits routed claim. 2. Delegate logs in, opens inbox, approves. | Claim in delegate's inbox; timeline reads "approved by <delegate> on behalf of <manager>" | TBD |
| E2E-07 | Manager cannot approve own claim | Manager | Manager logged in | 1. Manager submits own routed claim. 2. Opens the claim and the inbox. 3. Calls POST /actions approve via devtools/fetch. | Claim not in own inbox; no Approve button; API returns 403 | TBD |
| E2E-08 | Reused receipt is auto-rejected | Employee | Receipt file already used on a non-rejected claim | 1. New claim, upload the same file. 2. Submit. | AUTO_REJECTED with DUPLICATE_RECEIPT_HASH reason | TBD |
| E2E-09 | Auditor filters queue and bulk approves | Auditor | Several seeded claims at AUDITOR step and in SAMPLE_AUDIT | 1. Open audit queue, kind=auditor_step, filter department + flag. 2. Select 3 rows, bulk approve with comment. 3. Switch to kind=sample_audit, clear one. | Filters narrow the list; bulk shows per-claim result; cleared sample claim becomes APPROVED and appears in payouts eligible | TBD |
| E2E-10 | Employee sees only own claims; dashboard for finance | Employee, head | Seeded data | 1. Employee: My claims; try `/claims/<colleague id>` URL. 2. Head: open dashboard. | Employee sees only own claims; colleague URL shows "not found"; dashboard shows KPIs, spend by category/department/month, violations by rule, avg approval time | TBD |

## 6. UI test cases

| ID | Area | Case | Expected | Result |
|---|---|---|---|---|
| UI-01 | 390 px phone | Login, My claims, claim editor, claim detail at 390 × 844 | No horizontal scroll; tap targets ≥ 44 px; line items stack as cards; amounts in en-IN (₹1,50,000.00) | TBD |
| UI-02 | 390 px phone | Upload receipt from phone (file input with camera) | Upload progress, then filename and size shown; error message for > 5 MB | TBD |
| UI-03 | 390 px phone | Approval inbox and receipt viewer | Receipt opens full-width; Approve / Send back / Reject reachable without zoom | TBD |
| UI-04 | Keyboard only | Log in, create claim, add 2 lines, submit, using Tab / Shift+Tab / Enter / Space only | Visible focus ring on every control; logical order; no traps; dialogs close on Esc and return focus | TBD |
| UI-05 | Keyboard only | Manager approves from inbox; auditor bulk-selects with keyboard | Checkboxes and actions reachable; confirmation dialog announces result | TBD |
| UI-06 | Loading | Slow network (Playwright route delay 2 s) on inbox, claim detail, dashboard | Skeleton / spinner shown; buttons disabled while submitting (no double submit) | TBD |
| UI-07 | Empty | New employee with no claims; manager with empty inbox; audit queue with filters matching nothing | Friendly empty message with next action ("Create your first claim") | TBD |
| UI-08 | Error | API returns 409 (someone else acted first) on approve | Message "This claim was already actioned"; detail refreshes to the new state | TBD |
| UI-09 | Error | API 422 on save (future date) | Field-level message next to the line; data entered is kept | TBD |
| UI-10 | Error | Session expired (401) | Redirect to login with a message; after login return to the page | TBD |
| UI-11 | Accessibility | Status chips and policy flags | Text label, not colour only; contrast ≥ 4.5:1; form fields have labels | TBD |
| UI-12 | Allowed actions | Buttons match `allowed_actions` for each persona and state | No button offered that the API would reject | TBD |

## 7. Defect handling

Severity: Critical (bypass, wrong payout, data leak), Major (flow blocked), Minor (cosmetic). A Critical blocks the demo build until fixed and covered by a regression test.

## 8. Metrics and monitoring checks

`/metrics` exposes the five metric families in CLAUDE.md; after E2E-03, `expenseflow_claim_transitions_total{to_status="PAID"}` has increased; Grafana panels show queue size and oldest pending hours.

## 9. Security checklist (OWASP Top 10 style)

| # | Area | Check | How verified | Status |
|---|---|---|---|---|
| SEC-01 | Broken access control | Employee cannot read/act on others' claims (404); role matrix for every endpoint; no self-approval incl. delegation | `test_api_security.py::test_role_matrix`, bypass table tests | TBD |
| SEC-02 | Broken access control | Receipts served only to uploader or viewers of a claim using them | `test_api_receipts.py::test_receipt_visibility` | TBD |
| SEC-03 | Injection | All SQL parameterised; queue filters cannot inject (e.g. `q=' OR 1=1--`) | code review grep for f-strings in SQL; `test_audit_queue_filter_injection` | TBD |
| SEC-04 | Authentication / session | Password hashed; cookie HttpOnly, SameSite=Lax, signed; tampered cookie → 401; logout clears it | `test_auth.py` | TBD |
| SEC-05 | CSRF | Non-GET without `X-Requested-With: ExpenseFlow` → 403 | `test_post_without_csrf_header_is_403` | TBD |
| SEC-06 | File upload | Only JPG/PNG/PDF by magic bytes; ≤ 5 MB; renamed on disk; `nosniff`; `.html` renamed `.png` rejected | `test_api_receipts.py` | TBD |
| SEC-07 | Secrets | `SESSION_SECRET`, DB password from env; none in repo, logs or images | repo grep, `docker compose config` review | TBD |
| SEC-08 | Vulnerable dependencies | `pip-audit` and `npm audit` in CI | CI job output | TBD |
| SEC-09 | Logging and audit | Every transition, delegation, policy edit, payout logged; audit_log UPDATE/DELETE raises; no secrets or cookies in logs | `test_audit_log.py`, log review | TBD |
| SEC-10 | Data protection | Synthetic data only; no real PII | seed review | TBD |
| SEC-11 | Security misconfiguration | Debug off in Docker; error responses do not leak stack traces | `test_error_body_shape` | TBD |
| SEC-12 | Integrity | Payout CSV deterministic; claim paid at most once | `test_payouts.py` | TBD |
