# CLAUDE.md — ExpenseFlow

Expense claims with a configurable policy engine, a threshold-based approval chain, an auditor queue, sample audit, payout CSV export, a dashboard and an append-only audit trail. AI Manthan Day 2, Team 01, Track A. Brief: `submission/brief-ExpenseFlow.docx`. Approved decisions D1–D15: `submission/ideation.md`.

## Stack (exact)
- Backend: Python 3.13, FastAPI, psycopg 3 (raw parameterised SQL, no ORM), PostgreSQL 18
- Frontend: React 19 + Vite 7 (Node 26.13.1), plain CSS with tokens in `frontend/src/tokens.css`, no UI framework
- One origin: FastAPI serves `frontend/dist` and `/api/*` on port **8080**
- Tests: pytest (backend), Playwright 1.60 (UI)
- Ops: Docker Compose (app, db, prometheus, grafana), GitHub Actions (tests + `pip-audit` + `npm audit`)

## Commands
```bash
docker compose up -d --build --wait          # whole stack, seeded (app :8080, grafana :3000, prometheus :9090)
cd backend && python -m pytest -q            # needs DATABASE_URL for integration tests; unit tests run without a DB
cd frontend && npm run dev                   # Vite dev server :5173, proxies /api to :8080
```

## Money, time, data
- Money is **integer paise** everywhere (`amount_paise`). ₹1,500 = 150000. The UI formats in en-IN.
- Timestamps are UTC in the DB (`timestamptz`) and shown in IST. Expense dates are plain `date`.
- Synthetic data only. Demo password for every seeded user: `demo123`.

## Roles
`employee`, `manager` (an employee with direct reports), `auditor`, `head` (finance head, also admin). Every user can also file their own claims.
An employee sees **only their own claims**. Managers see claims where they are the current approver (or a delegate). Auditors and the head see all claims.

## Claim state machine
| From | Action | Actor | To |
|---|---|---|---|
| DRAFT | edit | owner | DRAFT |
| DRAFT, NEEDS_CLARIFICATION, AUTO_REJECTED | submit | owner | policy decides: AUTO_REJECTED / PENDING_APPROVAL(step=MANAGER, or first applicable step) / APPROVED (auto) / SAMPLE_AUDIT (auto + sampled) |
| NEEDS_CLARIFICATION, AUTO_REJECTED | edit | owner | same state |
| PENDING_APPROVAL(step S) | approve | approver of S (or active delegate) | next step, or APPROVED if none left |
| PENDING_APPROVAL | reject | approver of current step | REJECTED (terminal) |
| PENDING_APPROVAL | send_back | approver of current step | NEEDS_CLARIFICATION (chain restarts on resubmit) |
| SAMPLE_AUDIT | clear / reject | auditor | APPROVED / REJECTED |
| APPROVED | add to batch | head | IN_PAYOUT |
| IN_PAYOUT | mark batch paid | head | PAID (terminal) |

**Forbidden:** any transition not in the table → HTTP 409. Wrong role or not the current approver → 403. Not visible to the user → 404.
Every transition is a conditional `UPDATE ... WHERE id=%s AND status=%s AND current_step IS NOT DISTINCT FROM %s`. 0 rows updated → 409 (someone else acted first).

### Approval steps (by claim total, strictly greater than)
1. MANAGER: always, if the claim is routed or its total is > ₹25,000.
2. AUDITOR: if total > 2,500,000 paise (₹25,000).
3. HEAD: if total > 10,000,000 paise (₹1,00,000).

### Who approves a step
- MANAGER: the claimant's `manager_id`. If null or equal to the claimant, the step is skipped and AUDITOR becomes mandatory.
- AUDITOR: any user with role `auditor` other than the claimant.
- HEAD: any user with role `head` other than the claimant. If the claimant is the only head, the step is skipped and the audit log records `head_step_skipped_self`.
- **Nobody approves their own claim, including via delegation.**
- Delegation: `delegations(delegator_id, delegate_id, start_date, end_date)`. During the window the delegate may act wherever the delegator could. Delegating to yourself is forbidden. The delegate cannot act on their own claim. The audit log stores `actor_id` plus `on_behalf_of_id`.

## Policy engine (pure function, `backend/app/policy.py`)
Rules come from the `policy_rules` table (code → integer value / JSON), **never hard-coded**. Seeded defaults:
| Code | Default | Outcome when broken |
|---|---|---|
| MEAL_DAILY_LIMIT | 150000 per employee per date, summed across all their non-rejected claims | ROUTE |
| HOTEL_NIGHT_LIMIT_TIER1 | 600000 × nights, city in TIER1_CITIES | ROUTE |
| HOTEL_NIGHT_LIMIT_OTHER | 400000 × nights | ROUTE |
| CAB_TRIP_LIMIT | 200000 per line (local_cab) | ROUTE |
| RECEIPT_REQUIRED_ABOVE | amount > 50000 with no receipt | REJECT |
| DUPLICATE_RECEIPT_HASH | same SHA-256 already on another line (any claim, not rejected) | REJECT |
| DUPLICATE_VENDOR_AMOUNT_DATE | same vendor (case-insensitive, trimmed) + amount + date as an earlier non-rejected line | ROUTE |
| WEEKEND_SPEND | expense_date is Sat/Sun | ROUTE |
| AUTO_APPROVE_MAX_TOTAL | 2500000 | clean claims above this are routed |
| AUDITOR_THRESHOLD | 2500000 | — |
| HEAD_THRESHOLD | 10000000 | — |
| SAMPLE_AUDIT_PERCENT | 10 | — |
| TIER1_CITIES | ["Mumbai","Delhi","Bengaluru","Chennai","Kolkata","Hyderabad","Pune"] | — |

Line outcome = worst of its rule results (REJECT > ROUTE > APPROVE). Claim outcome = worst line outcome; if APPROVE but total > AUTO_APPROVE_MAX_TOTAL → ROUTE.
Sample audit: auto-approved claim is sampled when `int(sha256(f"{claim_id}:{SAMPLE_SALT}"),16) % 100 < SAMPLE_AUDIT_PERCENT`.
Categories: `meals, hotel, local_cab, airfare, train, office_supplies, internet, other`.
Line validation: amount_paise > 0 and ≤ 100000000; expense_date not in the future and not older than 365 days; hotel needs city + nights ≥ 1; vendor required.

## API contract (all JSON, prefix /api)
Non-GET requests must send header `X-Requested-With: ExpenseFlow` (CSRF guard), else 403. Session: signed HttpOnly cookie, SameSite=Lax.
Error body: `{"detail": "human readable message", "code": "MACHINE_CODE"}`.

| Method & path | Who | Body / query | Response |
|---|---|---|---|
| POST /api/auth/login | anyone | {email, password} | {user} |
| POST /api/auth/logout | user | — | {ok} |
| GET /api/auth/me | user | — | {user:{id,name,email,role,department,manager_id,is_manager}} |
| GET /api/demo-users | anyone | — | list of {email,name,role} for the login page |
| GET /api/meta | user | — | {categories, tier1_cities, policy:[{code,description,value,outcome}]} |
| GET /api/claims | user | ?status= | own claims [{id,title,status,current_step,total_paise,line_count,flags,submitted_at,updated_at}] |
| POST /api/claims | user | {title} | claim (DRAFT) |
| GET /api/claims/{id} | owner, current approver/delegate, auditor, head | — | {claim, lines:[{...,outcome,reasons:[{code,message,outcome}]}], timeline:[audit entries], allowed_actions:[...]} |
| PUT /api/claims/{id} | owner, editable state | {title, lines:[{category,amount_paise,expense_date,vendor,city,nights,description,receipt_id}]} | claim detail |
| POST /api/claims/{id}/submit | owner | — | claim detail (with policy result) |
| POST /api/claims/{id}/actions | current approver/delegate or auditor (SAMPLE_AUDIT) | {action: approve\|reject\|send_back\|clear, comment} | claim detail |
| POST /api/receipts | user | multipart `file` (jpg/png/pdf, ≤5 MB) | {id, filename, sha256, content_type, size} |
| GET /api/receipts/{id} | anyone who can see a claim using it, or its uploader | — | file |
| GET /api/approvals/inbox | manager/auditor/head/delegate | — | claims where the user can act now, oldest first, with employee name, department, flags, age_hours |
| POST /api/approvals/bulk | auditor/head | {claim_ids, action:"approve", comment} | {results:[{claim_id, ok, status, error}]} |
| GET /api/audit/queue | auditor/head | ?kind=all\|auditor_step\|sample_audit&department=&category=&flag=&min_paise=&max_paise=&q= | rows as inbox |
| GET /api/delegations | user | — | mine (given and received) |
| POST /api/delegations | manager/auditor/head | {delegate_id, start_date, end_date} | delegation |
| DELETE /api/delegations/{id} | delegator | — | {ok} |
| GET /api/users/approvers | user | — | users who can be delegates [{id,name,role,department}] |
| GET /api/payouts/eligible | head | — | APPROVED claims not in a batch |
| POST /api/payouts | head | {claim_ids} | batch (claims → IN_PAYOUT) |
| GET /api/payouts | head | — | batches |
| GET /api/payouts/{id} | head | — | batch + items |
| GET /api/payouts/{id}/csv | head | — | text/csv mock bank file |
| POST /api/payouts/{id}/mark-paid | head | — | batch (claims → PAID) |
| GET /api/dashboard | auditor/head | ?months=6 | {kpis:{total_spend_paise, claims, pending, avg_approval_hours, violation_count, oldest_pending_hours}, by_category, by_department, by_month, violations_by_rule} |
| GET /api/audit-log | auditor/head | ?claim_id=&limit= | entries |
| GET /api/policy | user | — | rules |
| PUT /api/policy/{code} | head | {value} | rule (audited) |
| GET /healthz | anyone | — | {status:"ok", db:"ok"} |
| GET /metrics | anyone | — | Prometheus text |

`allowed_actions` values: `edit, submit, approve, reject, send_back, clear`.

### Mock bank file CSV
Header: `batch_id,line_no,beneficiary_employee_id,beneficiary_name,account_ref,ifsc,amount_inr,claim_id,narration`. Amount has 2 decimals. account_ref and ifsc are synthetic and deterministic per employee. Re-exporting gives a byte-identical file.

## Database (backend/app/schema.sql)
departments, users, policy_rules, claims, claim_lines, receipts, delegations, audit_log, payout_batches, payout_items (claim_id UNIQUE). `audit_log` is **append-only**: a trigger raises on UPDATE/DELETE.

## Metrics (Prometheus, /metrics)
`expenseflow_http_request_duration_seconds` (histogram, labels method, route, status), `expenseflow_approval_queue_size{step}` (gauge), `expenseflow_oldest_pending_approval_hours` (gauge), `expenseflow_claim_transitions_total{to_status}` (counter), `expenseflow_policy_outcomes_total{outcome}` (counter).

## Workflow rules for Claude
- Plan first: propose a file-by-file plan and wait for approval before large changes.
- Tests before the policy engine; every rule has a boundary test.
- Parameterised SQL only. Never log secrets. No real data.
- Commit after each verified slice, and only when the user agrees.

## Claude Usage Journal Rule
After every verified slice, append one row to `submission/claude-usage-journal.md`: #, Phase, Time (IST), CREATE prompt summary, output (files/features), Human Review / Correction (the user's real approval, decision or correction; never invented), Verification command + real result. Include it in that slice's commit.
