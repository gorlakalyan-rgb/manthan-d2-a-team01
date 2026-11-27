# ExpenseFlow — Security Checklist Run & Code Review

Claude reviewed the code against common web vulnerabilities (OWASP Top 10 style); the team triaged each finding as **real** (fixed or accepted with reason) or **false alarm** (with the evidence why). Tools: `pip-audit`, `npm audit`, repo grep for secrets, `curl -I`, and the automated tests named below.

## Checklist results
| ID | Area | Check | Result | Evidence |
|---|---|---|---|---|
| SEC-01 | Access control | Employee sees only own claims (404 on others); role guard on every finance endpoint; no self-approval incl. via delegation | PASS | `test_employee_sees_only_own_claims`, `test_employee_cannot_use_head_endpoints`, `test_self_approval_blocked`, `test_delegate_cannot_approve_own_claim`, E2E-07, E2E-10 |
| SEC-02 | Access control | Receipts served only to uploader, auditor/head, or someone who can view a claim using it | PASS | `GET /api/receipts/{id}` check in main.py; 404 otherwise |
| SEC-03 | Injection | All SQL parameterised | PASS | Code review: the 3 f-strings in SQL build column lists / WHERE fragments from **constants only**; all user input goes through `%s` params |
| SEC-04 | Auth / session | PBKDF2 password hash; signed HttpOnly SameSite=Lax cookie, 8h expiry; logout clears | PASS (with accepted risk below) | `auth.py`, `test_bad_password_and_csrf` |
| SEC-05 | CSRF | Non-GET `/api/*` without `X-Requested-With: ExpenseFlow` → 403 | PASS | `test_bad_password_and_csrf` |
| SEC-06 | File upload | Type by magic bytes (JPG/PNG/PDF), ≤ 5 MB, stored by SHA-256 name, `nosniff`, CSP on receipt responses | PASS | `test_upload_rejects_non_receipt_files` (HTML renamed .png → 415) |
| SEC-07 | Secrets | No secrets committed; session secret / DB password from env (`.env.example` only) | PASS | `git grep` for key/secret/password/token: only demo password + env placeholders; CI runs gitleaks |
| SEC-08 | Vulnerable dependencies | `pip-audit`, `npm audit` (CI job) | PASS after fix | Found starlette 0.50.0 (4 advisories) + pytest 8.4.2 → upgraded; now "No known vulnerabilities found"; npm: 0 vulnerabilities |
| SEC-09 | Logging / audit | Every transition, delegation, policy edit, payout, CSV export, login logged; audit table append-only | PASS | `test_audit_log_is_append_only` (UPDATE and DELETE raise) |
| SEC-10 | Data protection | Synthetic data only; bank refs are synthetic and deterministic | PASS | `seed.py` |
| SEC-11 | Misconfiguration | Errors return `{detail, code}` without stack traces; security headers | PASS after fix | Added `X-Frame-Options: DENY`, `Referrer-Policy: same-origin` (DEF-09) |
| SEC-12 | Integrity | A claim can be paid at most once; CSV re-export byte-identical; CSV formula-injection guard | PASS | `payout_items.claim_id UNIQUE`, `test_payout_batch_csv_and_no_double_payment` |

## Claude's review findings and triage
| # | Finding (from Claude's review) | Triage | Action / reason |
|---|---|---|---|
| F1 | starlette 0.50.0 has known advisories | **Real** | Upgraded (DEF-07) |
| F2 | No X-Frame-Options → clickjacking of approve buttons | **Real** | Header added (DEF-09) |
| F3 | No login rate limiting / lockout | **Real, accepted for demo** | Local synthetic demo; documented as backlog (add per-IP + per-account limiter) |
| F4 | Default `SESSION_SECRET` / Grafana `admin` password in compose | **Real, accepted for demo** | Overridable via `.env`; must be set for any non-local use (README) |
| F5 | Session cookie not `Secure` | **Real, accepted for demo** | App runs on http://localhost; set `https_only=True` behind TLS |
| F6 | f-string SQL in `transition()` and `/api/audit-log` | **False alarm** | Interpolated parts are internal column names / constant WHERE text; values are parameters |
| F7 | SVG served for receipts → stored XSS | **False alarm** | Users can't upload SVG (magic-byte allow-list); only server-generated synthetic receipts with HTML-escaped text, served with restrictive CSP |
| F8 | Employee could approve by calling the API directly | **False alarm** | Server-side `acting_identity` check; tested (403) |
| F9 | Race: two submits could each miss the other's meal total / receipt hash | **Real** | Advisory lock on submit (found in architecture bypass review) |
| F10 | Payout CSV formula injection via employee name | **Real (low)** | Guard prefixes `= + - @` names with `'` |
