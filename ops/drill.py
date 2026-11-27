"""SRE incident drill: stale approval (manager on leave, no delegation).

1. Baseline  - oldest pending approval < 72h, alert OldestPendingApprovalTooOld inactive.
2. Inject    - backdate one MANAGER-step claim's step_entered_at by 5 days (simulates an approver on leave).
3. Detect    - wait until Prometheus fires the alert.
4. Remediate - runbook steps: find the claim, manager delegates to finance head, head approves on behalf.
5. Verify    - gauge back under threshold, alert resolves, audit log shows "on behalf of".

Run with the stack up:  python ops/drill.py   (writes submission/drill-output.txt)
"""
import json
import subprocess
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx

APP, PROM = "http://localhost:8080", "http://localhost:9090"
H = {"X-Requested-With": "ExpenseFlow"}
ALERT = "OldestPendingApprovalTooOld"
OUT = Path(__file__).resolve().parents[1] / "submission" / "drill-output.txt"
log_lines = []


def log(msg):
    line = f"{datetime.now(timezone.utc).strftime('%H:%M:%SZ')} {msg}"
    print(line, flush=True)
    log_lines.append(line)


def gauge():
    r = httpx.get(f"{PROM}/api/v1/query", params={"query": "expenseflow_oldest_pending_approval_hours"}).json()
    res = r["data"]["result"]
    return float(res[0]["value"][1]) if res else None


def alert_state():
    alerts = httpx.get(f"{PROM}/api/v1/alerts").json()["data"]["alerts"]
    states = [a["state"] for a in alerts if a["labels"]["alertname"] == ALERT]
    return states[0] if states else "inactive"


def psql(sql):
    return subprocess.run(["docker", "compose", "exec", "-T", "db", "psql", "-U", "expenseflow", "-tA", "-c", sql],
                          capture_output=True, text=True, check=True).stdout.strip()


def login(email):
    c = httpx.Client(base_url=APP, headers=H)
    c.post("/api/auth/login", json={"email": email, "password": "demo123"}).raise_for_status()
    return c


def wait_for(pred, what, timeout=240):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pred():
            log(f"  ✓ {what} after {int(time.time() - t0)}s")
            return True
        time.sleep(5)
    log(f"  ✗ timed out waiting for {what}")
    return False


def main():
    log("=== ExpenseFlow SRE drill: stale approval ===")
    httpx.post(f"{PROM}/-/reload")
    time.sleep(3)
    log(f"[1] Baseline: oldest_pending={gauge():.1f}h alert={alert_state()}")

    mgr = login("manager@demo.expenseflow.test")
    mgr_id = mgr.get("/api/auth/me").json()["user"]["id"]
    claim_id = psql(f"""SELECT c.id FROM claims c JOIN users e ON e.id=c.employee_id
                       WHERE c.status='PENDING_APPROVAL' AND c.current_step='MANAGER' AND e.manager_id={mgr_id}
                       ORDER BY c.id LIMIT 1""")
    if not claim_id:
        log("no pending MANAGER claim for demo manager - aborting"); sys.exit(1)
    log(f"[2] Inject fault: claim #{claim_id} waiting on Maya Manager (on leave, no delegate); backdating step by 5 days")
    psql(f"UPDATE claims SET step_entered_at = now() - interval '5 days' WHERE id = {claim_id}")

    log("[3] Detect: waiting for Prometheus scrape + rule (for: 1m)")
    wait_for(lambda: (gauge() or 0) > 72, "gauge > 72h")
    log(f"    oldest_pending={gauge():.1f}h")
    wait_for(lambda: alert_state() == "firing", f"alert {ALERT} FIRING")

    log("[4] Remediate (runbook §Alert OldestPendingApprovalTooOld)")
    head = login("head@demo.expenseflow.test")
    stale = [r for r in head.get("/api/audit/queue", params={"kind": "all_pending"}).json() if str(r["id"]) == claim_id]
    log(f"    step 1 find claim: #{claim_id} '{stale[0]['title'] if stale else '?'}' age={stale[0]['age_hours'] if stale else '?'}h")
    head_id = head.get("/api/auth/me").json()["user"]["id"]
    d = mgr.post("/api/delegations", json={"delegate_id": head_id, "start_date": str(date.today()),
                                           "end_date": str(date.today() + timedelta(days=7))})
    d.raise_for_status()
    log(f"    step 2 delegation #{d.json()['id']} Maya Manager -> Farah Head for 7 days")
    r = head.post(f"/api/claims/{claim_id}/actions", json={"action": "approve", "comment": "Approved on behalf of Maya (on leave) - SRE drill"})
    r.raise_for_status()
    body = r.json()
    last = body["timeline"][-1]
    log(f"    step 3 approved by {last['actor_name']} on behalf of {last['on_behalf_of_name']} -> {body['claim']['status']}:{body['claim']['current_step'] or ''}")

    log("[5] Verify recovery")
    wait_for(lambda: (gauge() or 999) < 72, "gauge back under 72h")
    wait_for(lambda: alert_state() == "inactive", f"alert {ALERT} resolved")
    log(f"    oldest_pending={gauge():.1f}h alert={alert_state()}")
    audit = psql(f"SELECT action || ' by ' || actor_id || ' for ' || coalesce(on_behalf_of_id::text,'-') FROM audit_log "
                 f"WHERE entity='claim' AND entity_id={claim_id} ORDER BY id DESC LIMIT 1")
    log(f"    audit trail: {audit}")
    mgr.delete(f"/api/delegations/{d.json()['id']}")
    log("    cleanup: delegation removed")
    log("=== drill complete ===")
    OUT.write_text("\n".join(log_lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
