# ExpenseFlow — API Contract

Expanded from the table in `CLAUDE.md`. **Paths and field names are exactly those in CLAUDE.md**; this document adds examples and error cases. If they ever differ, CLAUDE.md wins.

## Conventions

| Item | Rule |
|---|---|
| Base | Same origin, port 8080. All endpoints under `/api` except `/healthz` and `/metrics`. JSON in and out (except receipt upload, receipt download and CSV). |
| Session | `POST /api/auth/login` sets a signed **HttpOnly, SameSite=Lax** cookie. All "user" endpoints need it → else **401**. |
| CSRF | Every non-GET `/api` request must send `X-Requested-With: ExpenseFlow` → else **403** `CSRF_HEADER_MISSING`. Applies to login too. |
| Money | Integer paise (`amount_paise`, `total_paise`). ₹1,500 = `150000`. The only decimal amount is `amount_inr` in the bank CSV. |
| Time | `*_at` fields are ISO-8601 UTC (`2026-11-27T05:30:00Z`); the UI shows IST. `expense_date`, `start_date`, `end_date` are `YYYY-MM-DD`. |
| Errors | Body is always `{"detail": "human readable message", "code": "MACHINE_CODE"}`. |
| Check order | 401 not logged in → 404 not visible to you → 403 wrong role / not current approver / own claim → 409 transition not allowed now (or lost a race) → 422 invalid data. |

### Status codes and machine codes

| HTTP | When | Typical `code` |
|---|---|---|
| 400 | Malformed request: body not JSON, missing multipart `file`, unknown query value | `BAD_REQUEST` |
| 401 | No / expired session, or wrong email or password at login | `NOT_AUTHENTICATED`, `INVALID_CREDENTIALS` |
| 403 | Missing CSRF header, wrong role, not the current approver, acting on own claim | `CSRF_HEADER_MISSING`, `FORBIDDEN`, `NOT_CURRENT_APPROVER`, `SELF_APPROVAL` |
| 404 | Resource does not exist **or** the user is not allowed to see it (same response, so ids are not confirmed) | `NOT_FOUND` |
| 409 | Transition not in the state table, claim not editable, someone else acted first (conditional UPDATE hit 0 rows), claim already in a batch | `INVALID_TRANSITION`, `NOT_EDITABLE`, `CONCURRENT_UPDATE`, `ALREADY_IN_BATCH` |
| 422 | Well-formed but invalid data: line validation, file type/size, delegation dates, self-delegation | `VALIDATION_ERROR`, `UNSUPPORTED_FILE_TYPE`, `FILE_TOO_LARGE`, `DELEGATE_SELF` |

The machine-code names above are the agreed vocabulary; the backend source is authoritative if a name differs.

Shared shapes used below:

```json
// ClaimSummary
{"id": 412, "title": "Pune client visit", "status": "PENDING_APPROVAL", "current_step": "MANAGER",
 "total_paise": 1835000, "line_count": 3, "flags": ["WEEKEND_SPEND"],
 "submitted_at": "2026-11-26T09:12:00Z", "updated_at": "2026-11-26T09:12:00Z"}

// ClaimDetail
{"claim": {"id": 412, "employee_id": 37, "employee_name": "Asha Rao", "title": "Pune client visit",
           "status": "PENDING_APPROVAL", "current_step": "MANAGER", "total_paise": 1835000,
           "flags": ["WEEKEND_SPEND"], "submitted_at": "2026-11-26T09:12:00Z", "updated_at": "2026-11-26T09:12:00Z"},
 "lines": [{"id": 1001, "category": "hotel", "amount_paise": 1200000, "expense_date": "2026-11-21",
            "vendor": "Hotel Deccan", "city": "Pune", "nights": 2, "description": "2 nights",
            "receipt_id": 88, "outcome": "APPROVE", "reasons": []},
           {"id": 1002, "category": "meals", "amount_paise": 85000, "expense_date": "2026-11-22",
            "vendor": "Vaishali", "city": null, "nights": null, "description": "Client lunch",
            "receipt_id": 89, "outcome": "ROUTE",
            "reasons": [{"code": "WEEKEND_SPEND", "message": "Expense date 22 Nov 2026 is a Saturday", "outcome": "ROUTE"}]}],
 "timeline": [{"id": 9001, "action": "submit", "actor_id": 37, "actor_name": "Asha Rao", "on_behalf_of_id": null,
               "from_status": "DRAFT", "to_status": "PENDING_APPROVAL", "step": "MANAGER", "comment": null,
               "created_at": "2026-11-26T09:12:00Z"}],
 "allowed_actions": ["approve", "reject", "send_back"]}
```

`allowed_actions` ⊆ `edit, submit, approve, reject, send_back, clear`, computed for the caller.

---

## Auth

### POST /api/auth/login — anyone
```http
POST /api/auth/login
X-Requested-With: ExpenseFlow
Content-Type: application/json

{"email": "asha.rao@expenseflow.test", "password": "demo123", "role": "employee"}
```
`role` is optional for API clients; the sign-in page always sends it (`employee` | `manager` | `auditor` | `head`).
`200` + `Set-Cookie: session=...; HttpOnly; SameSite=Lax; Path=/`
```json
{"user": {"id": 37, "name": "Asha Rao", "email": "asha.rao@expenseflow.test", "role": "employee",
          "department": "Sales", "manager_id": 12, "is_manager": false}}
```
Errors: 400 malformed body · 401 `BAD_CREDENTIALS` · 403 `ROLE_MISMATCH` (right password, wrong role chosen) · 403 `CSRF` · 422 unknown role.

### POST /api/auth/forgot — anyone
Body `{"email": "..."}` → always `200 {"ok": true, "message": "If an account exists…"}` (same answer for unknown emails, so accounts cannot be discovered).
Creates a signed reset token valid **15 minutes** and **single use** (it embeds a fingerprint of the current password hash).
Demo only: with `RESET_LINK_IN_RESPONSE=1` (no mail server) the response also contains `reset_url`. Audited as `password_reset_requested`.

### GET /api/auth/reset?token=… — anyone
`200 {"valid": true, "email_hint": "em••••@demo.expenseflow.test"}` · 400 `TOKEN_INVALID` | `TOKEN_EXPIRED` | `TOKEN_USED`.

### POST /api/auth/reset — anyone holding a valid token
Body `{"token": "...", "password": "..."}` → `200 {"ok": true}`; the old password and the token stop working. Audited as `password_reset`.
Errors: 400 token errors as above · 422 `WEAK_PASSWORD` (min 8 chars, letters and numbers).

### POST /api/auth/logout — user
Request: no body. `200 {"ok": true}` and the cookie is cleared. Errors: 401 · 403 (CSRF).

### GET /api/auth/me — user
`200`
```json
{"user": {"id": 12, "name": "Vikram Shah", "email": "vikram.shah@expenseflow.test", "role": "manager",
          "department": "Sales", "manager_id": 3, "is_manager": true}}
```
Errors: 401.

### GET /api/demo-users — anyone
`200`
```json
[{"email": "asha.rao@expenseflow.test", "name": "Asha Rao", "role": "employee"},
 {"email": "vikram.shah@expenseflow.test", "name": "Vikram Shah", "role": "manager"},
 {"email": "meera.iyer@expenseflow.test", "name": "Meera Iyer", "role": "auditor"},
 {"email": "rajesh.menon@expenseflow.test", "name": "Rajesh Menon", "role": "head"}]
```
No errors besides 5xx. Synthetic users only.

### GET /api/meta — user
`200`
```json
{"categories": ["meals", "hotel", "local_cab", "airfare", "train", "office_supplies", "internet", "other"],
 "tier1_cities": ["Mumbai", "Delhi", "Bengaluru", "Chennai", "Kolkata", "Hyderabad", "Pune"],
 "policy": [{"code": "MEAL_DAILY_LIMIT", "description": "Meals per employee per day", "value": 150000, "outcome": "ROUTE"}]}
```
Errors: 401.

---

## Claims

### GET /api/claims — user (own claims only)
`GET /api/claims?status=PENDING_APPROVAL` → `200 [ClaimSummary, ...]`, newest first.
Errors: 400 unknown `status` value · 401.

### POST /api/claims — user
```json
{"title": "Pune client visit"}
```
`201` (or `200`) → ClaimDetail with `status: "DRAFT"`, empty `lines`, `allowed_actions: ["edit", "submit"]`.
Errors: 400 · 401 · 403 (CSRF) · 422 title missing or longer than 200 characters.

### GET /api/claims/{id} — owner, current approver/delegate, auditor, head
`200` → ClaimDetail.
Errors: 401 · 404 not visible (e.g. an employee asking for a colleague's claim).

### PUT /api/claims/{id} — owner, editable state (DRAFT, NEEDS_CLARIFICATION, AUTO_REJECTED)
Replaces the title and the full line list.
```json
{"title": "Pune client visit",
 "lines": [{"category": "hotel", "amount_paise": 1200000, "expense_date": "2026-11-21", "vendor": "Hotel Deccan",
            "city": "Pune", "nights": 2, "description": "2 nights", "receipt_id": 88},
           {"category": "meals", "amount_paise": 85000, "expense_date": "2026-11-22", "vendor": "Vaishali",
            "city": null, "nights": null, "description": "Client lunch", "receipt_id": 89}]}
```
`200` → ClaimDetail (status unchanged).
Errors: 400 · 401 · 403 not the owner but can see it (e.g. auditor) · 404 · **409 `NOT_EDITABLE`** claim is PENDING_APPROVAL / APPROVED / etc. · **422 `VALIDATION_ERROR`**:
`amount_paise` ≤ 0 or > 100000000; `expense_date` in the future or older than 365 days; hotel without `city` or `nights` < 1; empty `vendor`; unknown `category`; `receipt_id` not uploaded by the owner.
```json
{"detail": "Line 2: expense date cannot be in the future", "code": "VALIDATION_ERROR"}
```

### POST /api/claims/{id}/submit — owner
No body. Runs line validation and the policy engine, then moves the claim per the state table.
`200` → ClaimDetail with per-line `outcome` and `reasons`. Possible resulting `status`: `AUTO_REJECTED`, `PENDING_APPROVAL` (with `current_step`), `APPROVED`, `SAMPLE_AUDIT`.
```json
{"claim": {"id": 415, "status": "AUTO_REJECTED", "current_step": null, "total_paise": 72000, "flags": ["RECEIPT_REQUIRED_ABOVE"]},
 "lines": [{"id": 1010, "category": "local_cab", "amount_paise": 72000, "receipt_id": null, "outcome": "REJECT",
            "reasons": [{"code": "RECEIPT_REQUIRED_ABOVE", "message": "Receipt required for amounts above ₹500.00", "outcome": "REJECT"}]}],
 "timeline": [], "allowed_actions": ["edit", "submit"]}
```
Errors: 401 · 403 not owner · 404 · 409 `INVALID_TRANSITION` (not in DRAFT / NEEDS_CLARIFICATION / AUTO_REJECTED) or `CONCURRENT_UPDATE` · 422 no lines, or a line fails validation.

### POST /api/claims/{id}/actions — current approver/delegate, or auditor (SAMPLE_AUDIT)
```json
{"action": "approve", "comment": "OK, matches client visit"}
```
`action` ∈ `approve | reject | send_back | clear`. `comment` is optional for approve/clear, **required** for reject and send_back.
`200` → ClaimDetail. The timeline entry records `actor_id` and, for a delegate, `on_behalf_of_id`.

| Action | Valid from | Result |
|---|---|---|
| approve | PENDING_APPROVAL(step S) | next step, or APPROVED |
| reject | PENDING_APPROVAL | REJECTED |
| send_back | PENDING_APPROVAL | NEEDS_CLARIFICATION (chain restarts on resubmit) |
| clear | SAMPLE_AUDIT | APPROVED |
| reject | SAMPLE_AUDIT (auditor) | REJECTED |

Errors: 400 unknown action · 401 · **403** `NOT_CURRENT_APPROVER` (e.g. auditor while step is MANAGER) or `SELF_APPROVAL` (own claim, directly or as a delegate) · 404 not visible · **409** `INVALID_TRANSITION` (e.g. `clear` on PENDING_APPROVAL, approve on APPROVED) or `CONCURRENT_UPDATE` (someone acted first) · 422 comment missing for reject/send_back.

---

## Receipts

### POST /api/receipts — user
`multipart/form-data` with one field `file` (JPG, PNG or PDF, ≤ 5 MB; type checked by file signature).
`201` (or `200`)
```json
{"id": 88, "filename": "hotel-deccan.pdf", "sha256": "9f2c...e41a", "content_type": "application/pdf", "size": 184233}
```
Errors: 400 no `file` field · 401 · 403 (CSRF) · 422 `UNSUPPORTED_FILE_TYPE` / `FILE_TOO_LARGE`.
Uploading a file whose hash already exists is **allowed** here; the duplicate is caught by `DUPLICATE_RECEIPT_HASH` at submit.

### GET /api/receipts/{id} — uploader, or anyone who can see a claim using it
`200` with the file bytes, `Content-Type` as stored, `Content-Disposition: inline; filename="..."`, `X-Content-Type-Options: nosniff`.
Errors: 401 · 404 missing or not visible.

---

## Approvals and audit queue

### GET /api/approvals/inbox — manager / auditor / head / delegate
Claims the caller can act on **now**, oldest first.
```json
[{"id": 412, "title": "Pune client visit", "status": "PENDING_APPROVAL", "current_step": "MANAGER",
  "total_paise": 1835000, "line_count": 3, "flags": ["WEEKEND_SPEND"], "submitted_at": "2026-11-26T09:12:00Z",
  "updated_at": "2026-11-26T09:12:00Z", "employee_name": "Asha Rao", "department": "Sales", "age_hours": 20.5,
  "on_behalf_of": null}]
```
A plain employee gets `200 []`. Errors: 401.

### POST /api/approvals/bulk — auditor / head
```json
{"claim_ids": [512, 513, 514], "action": "approve", "comment": "Bulk reviewed, receipts OK"}
```
Each claim goes through the same checks as a single approve; one failure does not undo the others.
`200`
```json
{"results": [{"claim_id": 512, "ok": true, "status": "APPROVED", "error": null},
             {"claim_id": 513, "ok": true, "status": "PENDING_APPROVAL", "error": null},
             {"claim_id": 514, "ok": false, "status": "PENDING_APPROVAL", "error": "NOT_CURRENT_APPROVER"}]}
```
Errors (whole request): 400 `action` other than `approve`, or empty / > 200 ids · 401 · 403 caller is not auditor/head, or CSRF · 422 ids not integers.

### GET /api/audit/queue — auditor / head
`GET /api/audit/queue?kind=sample_audit&department=Sales&category=meals&flag=WEEKEND_SPEND&min_paise=100000&max_paise=5000000&q=deccan`

| Param | Meaning |
|---|---|
| `kind` | `all` (default: claims the caller can act on now), `auditor_step` (PENDING_APPROVAL at AUDITOR), `head_step` (PENDING_APPROVAL at HEAD), `sample_audit` (SAMPLE_AUDIT), `all_pending` (**read-only oversight view**, added after SRE drill run 1 / DEF-06: every PENDING_APPROVAL or SAMPLE_AUDIT claim at **any** step, including MANAGER, oldest `step_entered_at` first, max 500 rows; the other filters still apply). An unrecognised value behaves like `all`. |
| `department` | department name |
| `category` | claim has at least one line in this category |
| `flag` | claim flags contain this rule code |
| `min_paise`, `max_paise` | total range, inclusive |
| `q` | text search on claim title or employee name (case-insensitive), or exact claim id |

`200` → rows in the same shape as the inbox. Errors: 401 · 403 not auditor/head (employees get 403 for every `kind`, including `all_pending`) · 422 non-integer amounts.

---

## Delegations and users

### GET /api/delegations — user
```json
{"given": [{"id": 7, "delegator_id": 12, "delegator_name": "Vikram Shah", "delegate_id": 15, "delegate_name": "Nisha Pillai",
            "start_date": "2026-12-01", "end_date": "2026-12-10", "active": false}],
 "received": []}
```
Errors: 401.

### POST /api/delegations — manager / auditor / head
```json
{"delegate_id": 15, "start_date": "2026-12-01", "end_date": "2026-12-10"}
```
`201` (or `200`) → the delegation object as above.
Errors: 401 · 403 caller is not an approver, or CSRF · 422 `SELF_DELEGATION` (delegate_id = caller), `VALIDATION` (missing/invalid dates, end before start, delegate not found).

### DELETE /api/delegations/{id} — delegator
`200 {"ok": true}`. Errors: 401 · 403 caller is the delegate, not the delegator · 404.

### GET /api/users/approvers — user
`200 [{"id": 15, "name": "Nisha Pillai", "role": "manager", "department": "Sales"}]` (excludes the caller). Errors: 401.

### GET /api/employees — head / auditor (everyone) · manager (own reporting tree)
Employee directory with per-employee spend totals, added in PR #3 (`8bcd1ea`). Scope is set in SQL by `directory_scope`: head and auditor see all users; a manager (or any user with direct reports) sees their whole reporting tree (recursive); anyone else gets 403.
Row fields (from `EMPLOYEE_STATS_SQL` in `main.py`): `id, name, email, role, department, department_id, manager_id, manager_name, account_masked, ifsc, direct_reports, delegation_active, claims, claimed_paise, approved_paise, paid_paise, pending_paise, pending_claims, rejected_claims, flagged_claims, last_claim_at`. Totals exclude drafts. Sorted by name. **Bank details** (`account_masked`, `ifsc`) are `null` unless the caller is head or auditor. Errors: 401 · 403 `FORBIDDEN_ROLE` (employee with no reports).

### GET /api/employees/{id} — same scope as above
`200` → `{employee, by_month, by_category, flags, by_status, recent_claims, direct_reports, manager_chain}`:
- `employee`: one row in the list shape above (bank details hidden for managers).
- `by_month`: approved/in-payout/paid spend per IST month, last 12 months `[{label: "YYYY-MM", value}]`.
- `by_category`: approved spend per line category; `flags`: count per policy rule code; `by_status`: count per status (drafts excluded).
- `recent_claims`: up to 25 latest non-draft claims (inbox row shape); `direct_reports`: `[{id, name, role, department}]`; `manager_chain`: up to 6 managers upwards.

Errors: 401 · 403 caller has no directory access · 404 `NOT_FOUND` employee does not exist **or is outside the caller's reporting tree** (existence is not confirmed). Test: `test_api.py::test_employee_directory_scoping`.

---

## Payouts (finance head only)

### GET /api/payouts/eligible — head
`200 [ClaimSummary + {"employee_name", "department"}]`, only `APPROVED` claims not in any batch (SAMPLE_AUDIT claims are excluded).
Errors: 401 · 403 not head.

### POST /api/payouts — head
```json
{"claim_ids": [301, 302, 305]}
```
`201` (or `200`) — all claims move to `IN_PAYOUT` atomically.
```json
{"id": 21, "status": "CREATED", "created_by": 3, "created_at": "2026-11-27T10:00:00Z",
 "total_paise": 4520000, "item_count": 3}
```
Errors: 400 empty list · 401 · 403 not head or CSRF · 404 an id does not exist · **409** `ALREADY_IN_BATCH` or `INVALID_TRANSITION` (a claim is not APPROVED); nothing is created.

### GET /api/payouts — head
`200 [{"id": 21, "status": "CREATED", "created_at": "...", "paid_at": null, "total_paise": 4520000, "item_count": 3}]`. Errors: 401 · 403.

### GET /api/payouts/{id} — head
```json
{"batch": {"id": 21, "status": "CREATED", "total_paise": 4520000, "item_count": 3, "created_at": "...", "paid_at": null},
 "items": [{"line_no": 1, "claim_id": 301, "employee_id": 37, "employee_name": "Asha Rao", "amount_paise": 1835000}]}
```
Errors: 401 · 403 · 404.

### GET /api/payouts/{id}/csv — head
`200 text/csv`, `Content-Disposition: attachment; filename="payout-batch-21.csv"`. Re-export is byte-identical.
```csv
batch_id,line_no,beneficiary_employee_id,beneficiary_name,account_ref,ifsc,amount_inr,claim_id,narration
21,1,37,Asha Rao,XXXX00000037,EFLW0000037,18350.00,301,ExpenseFlow claim 301
```
Errors: 401 · 403 · 404.

### POST /api/payouts/{id}/mark-paid — head
`200` → batch with `status: "PAID"`, `paid_at` set; its claims are `PAID`.
Errors: 401 · 403 · 404 · **409** batch already paid.

---

## Dashboard, audit log, policy

### GET /api/dashboard — auditor / head
`GET /api/dashboard?months=6`
```json
{"kpis": {"total_spend_paise": 1284500000, "claims": 3012, "pending": 46, "avg_approval_hours": 31.4,
          "violation_count": 418, "oldest_pending_hours": 212.0},
 "by_category": [{"category": "hotel", "total_paise": 512000000, "count": 640}],
 "by_department": [{"department": "Sales", "total_paise": 301000000, "count": 520}],
 "by_month": [{"month": "2026-06", "total_paise": 198000000, "count": 470}],
 "violations_by_rule": [{"code": "WEEKEND_SPEND", "count": 133}]}
```
Errors: 400 `months` not in 1..24 · 401 · 403.

### GET /api/audit-log — auditor / head
`GET /api/audit-log?claim_id=412&limit=50` → `200 [{"id", "claim_id", "action", "actor_id", "actor_name", "on_behalf_of_id", "from_status", "to_status", "step", "comment", "details", "created_at"}]`, newest first.
Errors: 400 bad limit · 401 · 403.
There is **no** endpoint to modify or delete audit entries, and the DB rejects it.

### GET /api/policy — user
`200 [{"code": "MEAL_DAILY_LIMIT", "description": "Meals per employee per day", "value": 150000, "outcome": "ROUTE", "updated_at": "..."}]`. Errors: 401.

### PUT /api/policy/{code} — head
```json
{"value": 200000}
```
`200` → the updated rule. An audit entry records old and new values. Applies to claims submitted afterwards.
Errors: 400 · 401 · 403 not head or CSRF · 404 unknown code · 422 wrong type (e.g. negative integer, percent outside 0–100, non-list for `TIER1_CITIES`).

---

## Operations

### GET /healthz — anyone
`200 {"status": "ok", "db": "ok"}`; if the DB is unreachable, `503 {"status": "degraded", "db": "error"}`.

### GET /metrics — anyone
`200 text/plain; version=0.0.4` Prometheus exposition:
`expenseflow_http_request_duration_seconds` (histogram: method, route, status), `expenseflow_approval_queue_size{step}`, `expenseflow_oldest_pending_approval_hours`, `expenseflow_claim_transitions_total{to_status}`, `expenseflow_policy_outcomes_total{outcome}`.
