# ExpenseFlow — Ideation Document

**Team 01 · Bengaluru · AI Manthan Day 2 (27 Nov 2026) · Track A**

## 1. Problem in one line
Replace email-and-Excel reimbursement with one system that checks every expense line against configurable policy, routes claims through a threshold-based approval chain, catches duplicates, and pays out through an auditable batch export.

## 2. Personas and goals
| Persona | Goal | Key screens |
|---|---|---|
| Employee | Submit a claim quickly from a phone and know its status | My claims, claim editor (line items + receipt upload), claim detail with timeline |
| Line manager | Approve their team's claims fast, with policy flags visible | Approval inbox, side-by-side receipt viewer, delegation settings |
| Finance auditor | Review high-value claims and sample audits efficiently | Review queue with filters + bulk approve, sample-audit queue |
| Finance head (admin) | Final approval above ₹1,00,000, payouts, policy configuration, oversight | Head approvals, payout batches + CSV export, policy config, dashboard |

## 3. Scope
**Must-have (from the brief):**
1. Multi-line claim: category, amount, date, receipt upload; save as draft; submit.
2. Policy engine per line → auto-approve / route for approval / auto-reject with a reason.
3. Approval chain: manager → finance auditor (claim total > ₹25,000) → finance head (> ₹1,00,000). Comment, send back for clarification, delegate while on leave.
4. Auditor review queue with filters and bulk approve; a random 10% of auto-approved claims are flagged for sample audit.
5. Payout batch of approved claims → CSV in mock bank-file format → claims move to Paid.
6. Dashboard: spend by category, department and month; policy violations; average approval time.
7. Append-only audit trail; an employee sees only their own claims.
8. Policy rules seeded as configuration (DB table), not hard-coded.
9. Synthetic data: 150 employees, 8 departments, reporting hierarchy, 3,000 historical claims with planted duplicates and limit breaches.

**Stretch (only if time allows):** real email notifications (mocked as an outbox), OCR of receipts, multi-currency, policy-edit UI with versioning (we will seed and display policy; editing is a stretch).

**Thinnest end-to-end slice (first target):** employee logs in → creates a 2-line claim with a receipt → submits → policy engine flags one line → manager approves → (if > ₹25k) auditor approves → finance head adds it to a payout batch → CSV downloads → claim shows Paid.

## 4. Gaps in the brief and our decisions
These are **proposals for the team to confirm** (see section 7).

| # | Gap | Proposed decision | Why |
|---|---|---|---|
| D1 | How a line's outcome maps to the claim | Claim outcome = worst line outcome: any **auto-reject** line → whole claim auto-rejected with all reasons (employee fixes and resubmits); else any **route** line → approval chain; else → auto-approve | Simple, explainable, no partial-claim payments |
| D2 | Which rule gives which outcome | **Auto-reject:** receipt missing for a line > ₹500; exact receipt-file-hash duplicate (same file already used on another claim). **Route (flagged):** over a category limit; vendor+amount+date duplicate; weekend spend. **Auto-approve:** no flags | Hash duplicate is near-certain fraud; vendor/amount/date can be legitimate (e.g. two colleagues' meals), so a human decides |
| D3 | Can a fully-clean claim skip humans regardless of size? | Auto-approve only if clean **and** claim total ≤ ₹25,000. Larger clean claims still go through the chain | Otherwise a ₹2 lakh claim could bypass the auditor and head |
| D4 | Threshold basis | Claim **total** (not per line), strictly "above": > ₹25,000 adds auditor; > ₹1,00,000 adds head | Matches the brief's wording |
| D5 | Meal limit "per day" | ₹1,500 per employee per calendar day, summed **across all their non-rejected claims** | Stops splitting one day's meals across claims |
| D6 | Hotel limit | Line records city + nights; limit = nights × ₹6,000 (tier-1: Mumbai, Delhi, Bengaluru, Chennai, Kolkata, Hyderabad, Pune) or nights × ₹4,000 | "Per night" needs a night count |
| D7 | Weekend | Expense date on Saturday or Sunday → flag for manager attention (route) | As per brief |
| D8 | Send back for clarification | Claim → `NEEDS_CLARIFICATION`; employee edits and resubmits; policy re-runs and the **chain restarts from the manager** | Edits after approval must be re-approved |
| D9 | Delegation | An approver sets a delegate + date range; the delegate can act during that window. The audit log records "approved by X on behalf of Y". You cannot delegate to yourself or to the claimant | Covers leave without a bypass |
| D10 | Self-approval / missing manager | Nobody can approve their own claim. If the claimant is the approver at a step (e.g. a manager's own claim, or the auditor's), it goes to that person's manager or the next level | Classic bypass |
| D11 | Sample audit | 10% of auto-approved claims (deterministic random by seed) → `SAMPLE_AUDIT`, held out of payout until the auditor clears them | Sample audit is pointless if the money is already paid |
| D12 | Payout | Only finance head creates batches from `APPROVED` claims; one claim can be in at most one batch (DB unique); export CSV; "mark paid" moves claims to `PAID`. Re-export reproduces the same file | Prevents double payment |
| D13 | Money and time | Amounts stored as integer paise; INR only; timestamps in UTC, displayed in IST | Avoids float errors |
| D14 | Auth | Seeded demo users with a shared demo password; session cookie; role checks in every endpoint | Synthetic demo only |
| D15 | Receipts | Stored on local disk (Docker volume), SHA-256 hash stored; types JPG/PNG/PDF, max 5 MB | Hash enables duplicate detection |

## 5. Hardest technical risks
1. **Approval bypass** (self-approval, splitting claims under thresholds, editing after approval, delegate abuse, acting out of turn). Mitigation: a server-side state machine with role + step guards, total-based thresholds, re-approval after edits, per-day meal aggregation, audit log of every action.
2. **Duplicate payments**: hash and vendor/amount/date duplicate detection at submit, plus a unique claim-in-batch constraint at payout.
3. **Concurrency**: two approvers acting at the same moment, or a double-clicked bulk approve. Mitigation: conditional state-transition UPDATE (`WHERE status = expected`) so only one wins.
4. **Policy as configuration**: rules live in a `policy_rules` table and the engine reads them, so changing a limit needs no code change.

## 6. Solution approach
- **Stack:** React 19 + Vite 7 frontend, FastAPI (Python 3.13) backend, PostgreSQL 18, Docker Compose (app + db + Prometheus + Grafana), pytest + Playwright, GitHub Actions with `pip-audit` / `npm audit` dependency check.
- **One origin:** FastAPI serves the built React app and the API on port 8080.
- **Tests first** for the policy engine (as the brief asks).

## 7. Success metrics
- All 9 must-have items work end to end on seeded data.
- Every policy rule has a passing unit test, including its boundary (₹1,500 vs ₹1,500.01, ₹500 vs ₹500.01, ₹25,000 vs ₹25,000.01).
- No duplicate payout possible (tested).
- `docker compose up` brings up a seeded demo in one command.
