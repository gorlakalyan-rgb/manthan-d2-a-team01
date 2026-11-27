# ExpenseFlow — SRE Runbook

**Service:** ExpenseFlow (expense claims, approvals, payouts) · **Owner:** Team 01 · **Stack:** FastAPI app (:8080) + PostgreSQL 18.7 + Prometheus (:9090) + Grafana (:3000), all in Docker Compose.

## 1. Service level objectives
| SLI | SLO | Source |
|---|---|---|
| Approval freshness: oldest claim waiting at its current step | **Warning SLA < 48 h** (nudge the approver); **critical < 72 h** (3 working days, page on-call) | `expenseflow_oldest_pending_approval_hours` |
| Approval backlog | < 150 claims pending across all steps | `sum(expenseflow_approval_queue_size)` |
| Page/API latency p95 (excluding /metrics) | < 1 s over 5 min | `expenseflow_http_request_duration_seconds` |
| Availability | `/healthz` = 200 and Prometheus `up == 1` | `up{job="expenseflow"}` |

Thresholds were validated against the seeded data. The seed caps current-step age at 40 h, so a fresh stack stays under the 48 h warning for about 8 hours, and normal per-step approval takes 2–60 h. 48 h is the team's internal warning SLA; 72 h means a claim is genuinely stuck and pages on-call. The dashboard tile says "Warning SLA 48 h · page at 72 h" to match these rules exactly.

**Before a demo:** reset to a clean green baseline with `docker compose down --volumes && docker compose up -d --build --wait`. The data ages in real time, so a stack seeded more than about 8 hours earlier will show the 48 h warning.

## 2. Quick reference
```bash
docker compose ps                                  # all 4 services should be healthy
curl -s localhost:8080/healthz                     # {"status":"ok","db":"ok"}
docker compose logs --tail 100 app                 # app logs
open http://localhost:3000  → Dashboards → ExpenseFlow → "ExpenseFlow — Operations"
open http://localhost:9090/alerts                  # alert states
docker compose exec db psql -U expenseflow         # database shell
```

## 3. Alerts

### Alert: OldestPendingApprovalWarning
**Fires when** `expenseflow_oldest_pending_approval_hours > 48` for 1 minute. **Severity:** warning (no page). **Impact:** a claim is about to breach the SLA.
**Action:** find the claim (Audit queue → "All pending (oversight, oldest first)", or the SQL in the next section) and **nudge the approver** by message or email. Check whether they are on leave; if so, ask them to set a delegate now, before the 72 h critical alert pages on-call. Nothing else is needed if the claim moves within the business day.

### Alert: OldestPendingApprovalTooOld
**Fires when** `expenseflow_oldest_pending_approval_hours > 72` for 1 minute. **Severity:** critical (pages on-call). **Impact:** an employee is waiting for reimbursement; usually the approver is on leave without a delegate. On-call must delegate or escalate now (steps below).

Diagnose:
1. Grafana panel "Oldest pending approval" shows the age; "Approval queue size by step" shows which step is stuck.
2. Find the claim — UI: sign in as finance head → **Audit queue → "All pending (oversight, oldest first)"**; the top row is the stale claim. Or SQL:
   ```sql
   SELECT c.id, c.title, c.current_step, e.name AS employee, m.name AS approver,
          round(extract(epoch FROM now() - c.step_entered_at)/3600) AS hours_waiting
   FROM claims c JOIN users e ON e.id = c.employee_id LEFT JOIN users m ON m.id = e.manager_id
   WHERE c.status = 'PENDING_APPROVAL' ORDER BY c.step_entered_at LIMIT 5;
   ```
3. Check whether the approver has an active delegation:
   ```sql
   SELECT * FROM delegations WHERE delegator_id = <approver_id> AND current_date BETWEEN start_date AND end_date;
   ```
Remediate:
1. If the approver is reachable → ask them to act (Approvals inbox).
2. If the approver is on leave → the approver (or IT on their behalf, with written approval) creates a **delegation** to another approver (Delegation page, or `POST /api/delegations`). The delegate approves; the audit log records "approved by X on behalf of Y".
3. Never update `claims.status` directly in SQL — it bypasses the state machine and audit trail.
Verify: the gauge drops below 72 h within one scrape (15 s) and the alert resolves; the claim timeline shows the on-behalf approval.

### Alert: ApprovalQueueBacklog
**Fires when** total pending > 150 for 5 min. Check which step is growing (Grafana). AUDITOR step → ask finance to use **bulk approve** on clean high-value claims; SAMPLE_AUDIT → clear samples; MANAGER → message department heads. If caused by a bad policy change (e.g. a limit set too low routes everything), revert it on the Policy page (change is audited) and confirm `expenseflow_policy_outcomes_total{outcome="ROUTE"}` rate drops.

### Alert: HighPageLatencyP95
**Fires when** p95 > 1 s for 2 min. Check the "Latency by route" panel for the slow route. Then:
```sql
SELECT pid, now() - query_start AS running, left(query, 120) FROM pg_stat_activity WHERE state = 'active' ORDER BY 2 DESC;
```
Common causes: dashboard aggregation over a very large claims table, or DB CPU. Mitigate: `docker compose restart app`; if DB-bound, `ANALYZE claims; ANALYZE claim_lines;`. Escalate if p95 stays > 1 s after 10 min.

### Alert: ExpenseFlowDown
**Fires when** Prometheus can't scrape the app for 1 min. `docker compose ps` → if app is unhealthy, `docker compose logs app`; if DB is down, `docker compose up -d db` then `docker compose restart app`. Confirm `curl localhost:8080/healthz`.

## 4. Routine operations
| Task | How |
|---|---|
| Start everything (seeded) | `docker compose up -d --build --wait` |
| Reset demo data | `docker compose down --volumes && docker compose up -d --build --wait` |
| Change a policy limit | Finance head → Policy page (value in ₹; stored as paise; audited) |
| Re-export a payout file | Payouts → batch → Download CSV (byte-identical on re-export) |
| Investigate who did what | `GET /api/audit-log?claim_id=<id>` or `SELECT * FROM audit_log WHERE entity_id=<id> ORDER BY id;` (table is append-only) |
| Run the incident drill | `python ops/drill.py` (needs the stack up) |

## 5. Rollback
- Application: `git checkout <previous tag/commit> && docker compose up -d --build --wait app` (schema changes are additive `CREATE ... IF NOT EXISTS`).
- Data: there are no destructive migrations; payout batches cannot be deleted (append-only audit + unique claim-in-batch), so a wrong batch is handled by finance off-system, never by editing rows.

## 6. Escalation
1st: on-call engineer (team member running the demo) → 2nd: team lead (Venkatesh) → Finance head for any payout question.
