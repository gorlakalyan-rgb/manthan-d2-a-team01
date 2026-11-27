# ExpenseFlow — 5-Minute Demo Script

**Team 01 · AI Manthan Day 2 · Track A** · Presenter drives one browser; a second person keeps time and reads the cue lines.

## Before the demo (T-15 min)
| Check | How |
|---|---|
| Clean, green baseline | `docker compose down --volumes && docker compose up -d --build --wait` (seeds 150 employees / 3,000 claims; about 3–4 min). The data ages in real time, so a stack seeded more than ~8 h earlier will show the 48 h warning (runbook §Thresholds). |
| Four tabs ready | App http://localhost:8080 (signed out) · Grafana http://localhost:3000 "ExpenseFlow — Operations" · Prometheus http://localhost:9090/alerts · `submission/drill-output.txt` + `submission/incident-rca.md` open in the editor |
| Receipt files | One small PNG or PDF on the desktop for the claim upload |
| Phone view | Browser DevTools device toolbar set to 390 × 844 (toggle on/off with Ctrl+Shift+M) |
| Backup video | Record in advance: `cd frontend && node demo-video/record-demo.mjs <outDir>` (~60 s captioned walkthrough of the live stack and Grafana). Play it if the live stack fails. Screenshots in `submission/screenshots/` are the second fallback. |

### Demo logins (synthetic data only; password `demo123` for all)
On the sign-in page, pick the matching **Sign in as** role tile, then enter the email and password.

| Role tile | Email | Shown as |
|---|---|---|
| Employee | `employee@demo.expenseflow.test` | Esha Employee |
| Manager | `manager@demo.expenseflow.test` | Maya Manager (Esha's manager) |
| Finance auditor | `auditor@demo.expenseflow.test` | Arun Auditor |
| Finance head | `head@demo.expenseflow.test` | Farah Head (admin) |

---

## 0:00 – 0:30 · Problem and business ROI
**Show:** sign-in page.
**Say:** "Expense claims today run on email threads and Excel. Policy breaches slip through, the same receipt gets paid twice, and managers take days to respond. ExpenseFlow puts every claim through a configurable policy engine and a manager → auditor → head approval chain. The outcomes we built for: no duplicate payouts, limits finance can change without a deploy, a 48-hour approval warning, and a full audit trail for every action."

## 0:30 – 1:30 · Employee claim capture + live policy engine
**Do (as Employee):**
1. Toggle the 390 px phone view. **My claims → New claim**. Point out: one column, large tap targets, no horizontal scroll.
2. Add a **local cab** line of **₹720** on a weekday, **no receipt** → **Submit claim** → status **Auto-rejected**, reason *"Receipt required…"* (rule `RECEIPT_REQUIRED_ABOVE`, ₹500).
3. Toggle back to desktop. Edit the claim: **Upload receipt**, change the amount to **₹2,600** → **Submit claim** → status **Pending approval · Manager**, flag `CAB_TRIP_LIMIT` (₹2,000 per trip).

**Say:** "Every line gets one of three outcomes with a human-readable reason: auto-approve, route, or auto-reject. The limits come from a config table, not code; the finance head can change them on the Policy page and every edit is audited."

## 1:30 – 2:30 · Manager review + auditor queue
**Do (as Manager):** **Approvals** → open Esha's claim. Receipt on the right, lines and policy flags on the left. Press **A** on the keyboard → *"Approved."* (S = send back, R = reject, J/K = next/previous).
**Say:** "Side-by-side review. Our Playwright run measures inbox → receipt → approved at under 0.6 s of app time (597 ms, `test-evidence/approver-flow-timing.json`)."

**Do (as Finance auditor):** **Audit queue** → tab **Auditor step**, filter by department and a flag → tick 3 rows → **Approve all** → per-claim results. Switch to tab **Sample audit** → open one claim → **Clear sample audit** (or press **A**).
**Say:** "A random 10% of auto-approved claims are held for sample audit and cannot be paid until an auditor clears them. The sample is deterministic per claim, so nobody can re-roll it."

## 2:30 – 3:15 · Finance head: payouts + dashboard
**Do (as Finance head):** **Payouts** → select approved claims → **Create batch** → **Download CSV** → download it again → **Mark paid** → claims show **Paid**.
**Say:** "The CSV is a mock bank file. Re-exporting gives a byte-identical file, and the database allows a claim in only one batch, so a claim cannot be paid twice."
**Do:** **Dashboard** → spend by category, department and month, policy violations by rule, average approval time → click a department to drill into its queue.

## 3:15 – 4:15 · SRE highlight: two-tier alerting and the incident drill
**Show:** Prometheus **/alerts** (5 rules, all inactive at baseline) → Grafana "ExpenseFlow — Operations" (queue size, oldest pending hours with the "Warning SLA 48 h · page at 72 h" tile, latency).
**Say:** "Two tiers on the oldest pending approval: above 48 h is a warning to nudge the approver; above 72 h is critical and pages on-call."
**Show:** `drill-output.txt`.
**Say:** "We ran a real incident drill: a claim stuck with a manager on leave and no delegate. **Run 1** — the alert fired after 60 s, but the finance head's queue could not find the stuck claim; it showed `'?' age=?h`. That was a real gap (DEF-06). We added a read-only **All pending (oversight, oldest first)** queue. **Run 2** — alert fired after 66 s, the head found claim #1821 at 120 h straight away, delegated and approved on the manager's behalf, and the alert resolved 5 s after the gauge dropped."
**Do (optional, 5 s):** Audit queue → **All pending (oversight, oldest first)** tab.

## 4:15 – 5:00 · Claude across the lifecycle
**Show:** `CLAUDE.md` → `submission/claude-usage-journal.md` (row 9) → `.claude/skills/approval-workflow-app/SKILL.md`.
**Say:** "`CLAUDE.md` was the persistent spec for every Claude session: state machine, policy table, API contract. Policy tests were written before the engine. Claude reviewed our design as a sceptical finance auditor and listed 20 ways to bypass approvals; each maps to a control and a test. The journal records where we corrected Claude: the two-tier 48/72 h alerts, seed tuning, the oversight queue, and three security findings we rejected as false alarms with evidence. The method is packaged as a reusable Claude skill for the next approval-workflow app. Questions?"

---

## Fallbacks
| Problem | Do this |
|---|---|
| Stack not healthy | `docker compose ps`; `docker compose logs app --tail 50`; restart with the one-command start. If not fixed within 30 s, play the backup video. |
| Claim auto-approves instead of routing | It was picked for sample audit or stayed under a limit. Use ₹2,600 for a cab line (limit ₹2,000) on a weekday. |
| No claims in auditor queue | Use the **All pending** or **Sample audit** tab; the seed keeps several claims at each step. |
| 48 h warning already firing | The stack was seeded more than ~8 h ago. Say so (it shows the warning tier working) or reset with `docker compose down --volumes`. |
| Running long | Skip the optional oversight-tab click and the second CSV download. |
