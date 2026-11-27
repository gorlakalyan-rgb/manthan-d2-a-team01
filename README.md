# ExpenseFlow — Expense Claims & Policy-Driven Approvals

AI Manthan Hackathon · Day 2 (27 Nov 2026) · **Team 01** · Track A (Application Development)

Employees file multi-line expense claims with receipts. A **configurable policy engine** auto-approves, routes or auto-rejects every line. Claims then go through a **manager → finance auditor (> ₹25,000) → finance head (> ₹1,00,000)** approval chain with comments, send-back and delegation. Auditors work a filterable queue with bulk approve and a 10% sample audit. The finance head exports **payout batches as a mock bank CSV**, and a dashboard shows spend and violations. Every action goes into an **append-only audit trail**.

## One-command start
```bash
docker compose up -d --build --wait
```
| What | URL |
|---|---|
| App | http://localhost:8080 |
| Grafana (dashboard "ExpenseFlow — Operations") | http://localhost:3000 (anonymous view; admin/admin) |
| Prometheus (alerts) | http://localhost:9090/alerts |

The first start builds the images and seeds **150 employees, 8 departments, a reporting hierarchy and 3,000 historical claims** with planted duplicates and limit breaches. This takes about 3–4 minutes. To reset: `docker compose down --volumes`, then run the command again.

### Demo users (password `demo123`)
| Persona | Email |
|---|---|
| Employee | employee@demo.expenseflow.test |
| Line manager (Esha's manager) | manager@demo.expenseflow.test |
| Finance auditor | auditor@demo.expenseflow.test |
| Finance head (admin) | head@demo.expenseflow.test |

## Tests
```bash
# backend: 23 policy unit tests + 21 API tests on real PostgreSQL 18
docker run -d --name expenseflow-devdb -e POSTGRES_USER=expenseflow -e POSTGRES_PASSWORD=expenseflow -e POSTGRES_DB=expenseflow -p 5433:5432 postgres:18.7
cd backend && py -3.13 -m venv .venv && .venv/Scripts/pip install -r requirements.txt && .venv/Scripts/python -m pytest -q

# UI end-to-end (stack must be up), uses installed Edge
cd frontend && npm ci && npx playwright test

# the 10 written E2E cases + the SRE incident drill, against the running stack
python ops/e2e_cases.py
python ops/drill.py
```
CI (`.github/workflows/ci.yml`) runs pytest on PostgreSQL 18, the frontend build, **pip-audit + npm audit** (dependency check), a **gitleaks** secret scan, and a one-command compose start with a smoke test.

## Architecture
React 19 + Vite 7 → FastAPI (Python 3.13, same origin on :8080) → PostgreSQL 18.7. Prometheus scrapes `/metrics`. Grafana is provisioned with the ops dashboard and Prometheus has 4 alert rules. Details are in [`submission/low-level-design.md`](submission/low-level-design.md), [ADR-01 approval chain](submission/adr-01-approval-chain.md) and [ADR-02 policy as config](submission/adr-02-policy-as-config.md). The business rules, state machine and API contract are in [`CLAUDE.md`](CLAUDE.md).

## Submission index
| Item | File |
|---|---|
| Ideation (gaps → decisions D1–D15) | [submission/ideation.md](submission/ideation.md) |
| Stories (Excel) | [submission/stories.xlsx](submission/stories.xlsx) |
| LLD, diagrams, bypass review | [submission/low-level-design.md](submission/low-level-design.md) |
| 2 ADRs | [ADR-01](submission/adr-01-approval-chain.md), [ADR-02](submission/adr-02-policy-as-config.md) |
| API contract | [submission/api-contract.md](submission/api-contract.md) |
| Test plan / results / defect log | [test-plan](submission/test-plan.md), [test-results](submission/test-results.md), [defect-log.csv](submission/defect-log.csv), [test-evidence/](submission/test-evidence) |
| Security checklist run | [submission/security-review.md](submission/security-review.md) |
| UI design: wireframes, design tokens, table states, accessibility | [submission/ui-design.md](submission/ui-design.md) |
| UI designs (screenshots) | [submission/screenshots/](submission/screenshots) |
| Runbook + incident RCA | [runbook](submission/runbook.md), [RCA](submission/incident-rca.md), [drill output](submission/drill-output.txt) |
| Claude usage journal | [submission/claude-usage-journal.md](submission/claude-usage-journal.md) |
| CLAUDE.md + reusable asset (Claude skill) | [CLAUDE.md](CLAUDE.md), [.claude/skills/approval-workflow-app/SKILL.md](.claude/skills/approval-workflow-app/SKILL.md) |

## Notes
- All data is synthetic. Do not use real names, bank details or receipts.
- `SESSION_SECRET`, `POSTGRES_PASSWORD` and `GRAFANA_ADMIN_PASSWORD` default to demo values. Override them in `.env` (see `.env.example`) for any non-local use.
