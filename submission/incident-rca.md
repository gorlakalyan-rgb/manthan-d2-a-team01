# Incident RCA — Stale approval (SRE drill, 27 Nov 2026)

**Type:** planned drill (fault injection) · **Severity:** SEV-3 (one reimbursement delayed, no data loss) · **Status:** Resolved · **Evidence:** `submission/drill-output.txt` (raw script output), `ops/drill.py`

## Summary
A claim (#1611 in run 1, #1821 in run 2) sat at the MANAGER step because the approver (Maya Manager) was "on leave" with no delegate. The `OldestPendingApprovalTooOld` alert fired 60–66 s after the gauge crossed 72 h. The responder delegated Maya's approvals to the finance head, who approved on her behalf; the alert resolved 5 s after the next scrape.

**Blast radius:** 1 claim, 1 employee waiting; payouts and other approvals unaffected.

## Timeline (UTC, run 2 — the verified run after the fix)
| Time | Event |
|---|---|
| 09:46:25 | Baseline: oldest pending 44.5 h, alert inactive |
| 09:46:26 | Fault injected: claim #1821 step age backdated by 5 days (approver on leave, no delegate) |
| 09:46:37 | Prometheus gauge `expenseflow_oldest_pending_approval_hours` = 120.0 h |
| 09:47:44 | Alert **OldestPendingApprovalTooOld FIRING** (66 s; rule has `for: 1m`) |
| 09:47:44 | Responder finds #1821 "Office purchase - Nov 2026", 120 h, via Audit queue → All pending (oversight) |
| 09:47:44 | Delegation #2 Maya Manager → Farah Head (7 days) |
| 09:47:44 | Farah Head approves on behalf of Maya Manager → claim APPROVED |
| 09:47:55 | Gauge back to 44.5 h |
| 09:48:00 | Alert resolved |
| 09:48:02 | Audit trail verified: `approve_manager by 1 for 6` (actor = head, on behalf of = manager); delegation removed |

## Root cause
1. **Trigger:** an approver was unavailable and had not set a delegate. The workflow correctly refused to let anyone else act (no bypass), so the claim waited.
2. **Contributing cause found by the drill (run 1, 09:44:28):** the responder **could not find the stuck claim in the UI**. The finance head's audit queue only listed claims *they* could act on, and a MANAGER-step claim isn't theirs — the drill log shows `find claim: #1611 '?' age=?h`. In a real incident this would have forced someone to query the database directly.

## Fix (done during the drill)
- Added an **"All pending (oversight, oldest first)"** read-only view (`GET /api/audit/queue?kind=all_pending`, auditor/head only) — run 2 found the claim immediately.
- Regression test `test_oversight_queue_shows_stale_claims_at_any_step` (also asserts employees get 403).
- Runbook updated with the UI path and SQL fallback.

## What went well
- Alert fired within the `for: 1m` window; dashboard showed which step was stuck.
- Delegation worked without any database edits; the audit log captured "on behalf of".
- No one could approve outside the chain, even under pressure.

## Follow-up actions
| # | Action | Owner | Status |
|---|---|---|---|
| 1 | Oversight queue for finance (all pending, oldest first) | Team 01 | Done |
| 1b | Two-tier approval-age alerting: `OldestPendingApprovalWarning` > 48 h (warning, nudge the approver) and `OldestPendingApprovalTooOld` > 72 h raised to **critical** (page on-call). Dashboard tile reads "Warning SLA 48 h · page at 72 h". The drills above ran with the single 72 h rule. | Team 01 (team decision after review) | Done |
| 2 | Warn approvers who have pending items when they have no delegate set for upcoming leave | Team 01 | Backlog |
| 3 | Auto-escalate a MANAGER step to the manager's manager after 72 h (configurable in `policy_rules`) | Team 01 | Backlog |
| 4 | Add an alert on per-step age (not just global oldest) so a stuck AUDITOR queue is visible separately | Team 01 | Backlog |
