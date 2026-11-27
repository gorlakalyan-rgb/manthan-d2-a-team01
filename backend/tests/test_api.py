"""API / workflow integration tests against real PostgreSQL 18 (concurrency must not be tested on SQLite).

Needs TEST_DATABASE_URL (default: dev container on :5433, database expenseflow_test). Skipped if unreachable.
"""
import os
import threading
from datetime import date, timedelta

import psycopg
import pytest

ADMIN_URL = os.getenv("TEST_ADMIN_URL", "postgresql://expenseflow:expenseflow@localhost:5433/expenseflow")
TEST_URL = os.getenv("TEST_DATABASE_URL", "postgresql://expenseflow:expenseflow@localhost:5433/expenseflow_test")
os.environ["DATABASE_URL"] = TEST_URL


def _db_available():
    try:
        with psycopg.connect(ADMIN_URL, autocommit=True, connect_timeout=3) as c:
            if not c.execute("SELECT 1 FROM pg_database WHERE datname='expenseflow_test'").fetchone():
                c.execute("CREATE DATABASE expenseflow_test")
        return True
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _db_available(), reason="PostgreSQL test database not reachable")

H = {"X-Requested-With": "ExpenseFlow"}


def weekday(days_back=3):
    d = date.today() - timedelta(days=days_back)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


@pytest.fixture(scope="module")
def app_client():
    from app import db, seed
    with db.connect(TEST_URL) as conn:
        db.reset_schema(conn)
        seed.seed(conn, n_claims=150)
        conn.commit()
    from fastapi.testclient import TestClient
    from app.main import app
    return lambda: TestClient(app)


def login(make, email):
    c = make()
    r = c.post("/api/auth/login", json={"email": email, "password": "demo123"}, headers=H)
    assert r.status_code == 200, r.text
    return c


EMP, EMP2, MGR, AUD, HEAD = (f"{x}@demo.expenseflow.test" for x in ("employee", "employee2", "manager", "auditor", "head"))
_png_counter = [0]


def receipt(c, content=None):
    _png_counter[0] += 1
    data = content or (b"\x89PNG\r\n\x1a\n" + f"unique-{_png_counter[0]}-{os.getpid()}".encode())
    r = c.post("/api/receipts", files={"file": ("r.png", data, "image/png")}, headers=H)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def make_claim(c, lines, title="Test claim"):
    cid = c.post("/api/claims", json={"title": title}, headers=H).json()["claim"]["id"]
    r = c.put(f"/api/claims/{cid}", json={"title": title, "lines": lines}, headers=H)
    assert r.status_code == 200, r.text
    return cid


def submit(c, cid):
    r = c.post(f"/api/claims/{cid}/submit", headers=H)
    assert r.status_code == 200, r.text
    return r.json()["claim"]


def line(c, amount, category="airfare", vendor=None, d=None, with_receipt=True, **kw):
    _png_counter[0] += 1
    return {"category": category, "amount_paise": amount, "expense_date": str(d or weekday()),
            "vendor": vendor or f"Vendor {_png_counter[0]}", "receipt_id": receipt(c) if with_receipt else None, **kw}


def act(c, cid, action, comment="ok"):
    return c.post(f"/api/claims/{cid}/actions", json={"action": action, "comment": comment}, headers=H)


# ------------------------------------------------------------------ auth & access
def test_bad_password_and_csrf(app_client):
    c = app_client()
    assert c.post("/api/auth/login", json={"email": EMP, "password": "nope"}, headers=H).status_code == 401
    assert c.post("/api/auth/login", json={"email": EMP, "password": "demo123"}).status_code == 403   # no CSRF header
    assert c.get("/api/claims").status_code == 401


def test_employee_sees_only_own_claims(app_client):
    e1, e2 = login(app_client, EMP), login(app_client, EMP2)
    cid = make_claim(e1, [line(e1, 10000, "local_cab")])
    assert all(x["employee_id"] == e2.get("/api/auth/me").json()["user"]["id"] for x in e2.get("/api/claims").json())
    assert e2.get(f"/api/claims/{cid}").status_code == 404
    assert e2.put(f"/api/claims/{cid}", json={"title": "x", "lines": []}, headers=H).status_code == 404


def test_employee_cannot_use_head_endpoints(app_client):
    e = login(app_client, EMP)
    assert e.get("/api/payouts").status_code == 403
    assert e.put("/api/policy/CAB_TRIP_LIMIT", json={"value": 1}, headers=H).status_code == 403
    assert e.get("/api/dashboard").status_code == 403


# ------------------------------------------------------------------ policy outcomes end-to-end
def test_clean_small_claim_auto_approves_or_samples(app_client):
    e = login(app_client, EMP)
    claim = submit(e, make_claim(e, [line(e, 120000, "local_cab")]))
    assert claim["status"] in ("APPROVED", "SAMPLE_AUDIT") and claim["auto_approved"]


def test_missing_receipt_above_500_auto_rejects(app_client):
    e = login(app_client, EMP)
    claim = submit(e, make_claim(e, [line(e, 50001, "local_cab", with_receipt=False)]))
    assert claim["status"] == "AUTO_REJECTED" and "RECEIPT_REQUIRED_ABOVE" in claim["flags"]


def test_reused_receipt_file_auto_rejects_second_claim(app_client):
    e = login(app_client, EMP)
    blob = b"\x89PNG\r\n\x1a\nsame-receipt-bytes"
    l1 = line(e, 30000, "local_cab"); l1["receipt_id"] = receipt(e, blob)
    submit(e, make_claim(e, [l1]))
    l2 = line(e, 31000, "local_cab"); l2["receipt_id"] = receipt(e, blob)
    claim = submit(e, make_claim(e, [l2]))
    assert claim["status"] == "AUTO_REJECTED" and "DUPLICATE_RECEIPT_HASH" in claim["flags"]


# ------------------------------------------------------------------ approval chain thresholds
def test_25k_needs_manager_only_then_approved(app_client):
    e, m = login(app_client, EMP), login(app_client, MGR)
    cid = make_claim(e, [line(e, 2500000, d=weekday(), category="airfare"), line(e, 100, "other", with_receipt=False)])
    claim = submit(e, cid)                       # 25,001 total > auto-approve cap, but not > auditor threshold? (25,001 > 25,000)
    assert claim["required_steps"] == ["MANAGER", "AUDITOR"]
    cid2 = make_claim(e, [line(e, 2500000, d=weekday(4), category="airfare", vendor="IndiGo exact")])
    c2 = submit(e, cid2)
    assert c2["status"] in ("APPROVED", "SAMPLE_AUDIT")   # exactly 25,000 and clean => auto-approve


def test_above_1_lakh_goes_manager_auditor_head(app_client):
    e, m, a, h = (login(app_client, x) for x in (EMP, MGR, AUD, HEAD))
    cid = make_claim(e, [line(e, 10000001, "airfare")])
    claim = submit(e, cid)
    assert claim["current_step"] == "MANAGER" and claim["required_steps"] == ["MANAGER", "AUDITOR", "HEAD"]
    assert act(a, cid, "approve").status_code == 403          # auditor cannot act out of turn
    assert act(m, cid, "approve").json()["claim"]["current_step"] == "AUDITOR"
    assert act(a, cid, "approve").json()["claim"]["current_step"] == "HEAD"
    final = act(h, cid, "approve").json()["claim"]
    assert final["status"] == "APPROVED"


def test_self_approval_blocked(app_client):
    m = login(app_client, MGR)
    cid = make_claim(m, [line(m, 3000000, "airfare")])
    claim = submit(m, cid)
    assert claim["status"] == "PENDING_APPROVAL"
    r = act(m, cid, "approve")
    assert r.status_code == 403 and r.json()["code"] == "SELF_APPROVAL"


def test_send_back_restarts_chain_from_manager(app_client):
    e, m, a = (login(app_client, x) for x in (EMP, MGR, AUD))
    cid = make_claim(e, [line(e, 3000000, "airfare")])
    submit(e, cid)
    act(m, cid, "approve")
    assert act(a, cid, "send_back", "").status_code == 422          # comment required
    assert act(a, cid, "send_back", "Attach boarding pass").json()["claim"]["status"] == "NEEDS_CLARIFICATION"
    e.put(f"/api/claims/{cid}", json={"title": "fixed", "lines": [line(e, 3000000, "airfare")]}, headers=H)
    assert submit(e, cid)["current_step"] == "MANAGER"


def test_reject_is_terminal(app_client):
    e, m = login(app_client, EMP), login(app_client, MGR)
    cid = make_claim(e, [line(e, 260000, "local_cab")])            # over cab limit -> routed
    submit(e, cid)
    assert act(m, cid, "reject", "Not business travel").json()["claim"]["status"] == "REJECTED"
    assert act(m, cid, "approve").status_code == 409
    assert e.post(f"/api/claims/{cid}/submit", headers=H).status_code == 409


# ------------------------------------------------------------------ delegation
def test_delegation_lets_delegate_act_on_behalf_and_is_audited(app_client):
    e, m, h = login(app_client, EMP), login(app_client, MGR), login(app_client, HEAD)
    h_id = h.get("/api/auth/me").json()["user"]["id"]
    assert m.post("/api/delegations", json={"delegate_id": m.get("/api/auth/me").json()["user"]["id"],
                  "start_date": str(date.today()), "end_date": str(date.today())}, headers=H).status_code == 422
    r = m.post("/api/delegations", json={"delegate_id": h_id, "start_date": str(date.today()),
                                         "end_date": str(date.today() + timedelta(days=3))}, headers=H)
    assert r.status_code == 200, r.text
    cid = make_claim(e, [line(e, 260000, "local_cab")])
    submit(e, cid)
    assert any(x["id"] == cid for x in h.get("/api/approvals/inbox").json())
    body = act(h, cid, "approve").json()
    assert body["claim"]["status"] == "APPROVED"
    assert body["timeline"][-1]["on_behalf_of_name"] == "Maya Manager"
    m.delete(f"/api/delegations/{r.json()['id']}", headers=H)


def test_delegate_cannot_approve_own_claim(app_client):
    m, e = login(app_client, MGR), login(app_client, EMP)
    e_id = e.get("/api/auth/me").json()["user"]["id"]
    d = m.post("/api/delegations", json={"delegate_id": e_id, "start_date": str(date.today()),
                                         "end_date": str(date.today())}, headers=H).json()
    cid = make_claim(e, [line(e, 260000, "local_cab")])
    submit(e, cid)
    assert act(e, cid, "approve").status_code == 403
    m.delete(f"/api/delegations/{d['id']}", headers=H)


# ------------------------------------------------------------------ concurrency
def test_parallel_approvals_only_one_wins(app_client):
    e = login(app_client, EMP)
    cid = make_claim(e, [line(e, 260000, "local_cab")])
    submit(e, cid)
    clients = [login(app_client, MGR) for _ in range(8)]
    barrier, codes = threading.Barrier(8), []

    def go(c):
        barrier.wait()
        codes.append(act(c, cid, "approve").status_code)

    threads = [threading.Thread(target=go, args=(c,)) for c in clients]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert codes.count(200) == 1 and all(c == 409 for c in codes if c != 200), codes


# ------------------------------------------------------------------ payouts
def test_payout_batch_csv_and_no_double_payment(app_client):
    e, m, h = login(app_client, EMP), login(app_client, MGR), login(app_client, HEAD)
    cid = make_claim(e, [line(e, 260000, "local_cab")])
    submit(e, cid)
    act(m, cid, "approve")
    r = h.post("/api/payouts", json={"claim_ids": [cid]}, headers=H)
    assert r.status_code == 200, r.text
    bid = r.json()["id"]
    assert h.post("/api/payouts", json={"claim_ids": [cid]}, headers=H).status_code == 409
    csv1, csv2 = h.get(f"/api/payouts/{bid}/csv").text, h.get(f"/api/payouts/{bid}/csv").text
    assert csv1 == csv2 and csv1.startswith("batch_id,line_no,") and ",2600.00," in csv1
    assert h.post(f"/api/payouts/{bid}/mark-paid", headers=H).json()["status"] == "PAID"
    assert h.post(f"/api/payouts/{bid}/mark-paid", headers=H).status_code == 409
    assert e.get(f"/api/claims/{cid}").json()["claim"]["status"] == "PAID"


def test_sample_audit_claims_not_payable_until_cleared(app_client):
    h = login(app_client, HEAD)
    from app import db
    with db.connect(TEST_URL) as conn:
        sid = conn.execute("SELECT id FROM claims WHERE status='SAMPLE_AUDIT' LIMIT 1").fetchone()
    if sid:
        assert h.post("/api/payouts", json={"claim_ids": [sid["id"]]}, headers=H).status_code == 409


# ------------------------------------------------------------------ audit trail & policy config
def test_audit_log_is_append_only(app_client):
    from app import db
    with db.connect(TEST_URL) as conn:
        with pytest.raises(psycopg.Error):
            conn.execute("UPDATE audit_log SET action='tampered' WHERE id = (SELECT min(id) FROM audit_log)")
        conn.rollback()
        with pytest.raises(psycopg.Error):
            conn.execute("DELETE FROM audit_log")


def test_policy_change_by_head_takes_effect_without_code_change(app_client):
    e, h = login(app_client, EMP), login(app_client, HEAD)
    assert h.put("/api/policy/CAB_TRIP_LIMIT", json={"value": 300000}, headers=H).status_code == 200
    claim = submit(e, make_claim(e, [line(e, 250000, "local_cab")]))
    assert "CAB_TRIP_LIMIT" not in claim["flags"]
    h.put("/api/policy/CAB_TRIP_LIMIT", json={"value": 200000}, headers=H)


def test_dashboard_and_metrics(app_client):
    h = login(app_client, HEAD)
    d = h.get("/api/dashboard").json()
    assert d["kpis"]["claims"] > 0 and d["by_category"] and d["by_department"]
    m = h.get("/metrics").text
    assert "expenseflow_oldest_pending_approval_hours" in m and "expenseflow_approval_queue_size" in m


def test_upload_rejects_non_receipt_files(app_client):
    e = login(app_client, EMP)
    r = e.post("/api/receipts", files={"file": ("x.html", b"<script>alert(1)</script>", "image/png")}, headers=H)
    assert r.status_code == 415


def test_oversight_queue_shows_stale_claims_at_any_step(app_client):
    """Regression for drill finding: head could not find a claim stuck at the MANAGER step."""
    e, h = login(app_client, EMP), login(app_client, HEAD)
    cid = make_claim(e, [line(e, 260000, "local_cab")])
    submit(e, cid)
    assert not any(r["id"] == cid for r in h.get("/api/audit/queue", params={"kind": "all"}).json())
    rows = h.get("/api/audit/queue", params={"kind": "all_pending"}).json()
    assert any(r["id"] == cid for r in rows)
    assert login(app_client, EMP).get("/api/audit/queue", params={"kind": "all_pending"}).status_code == 403


def test_employee_directory_scoping(app_client):
    head, aud, mgr, emp = (login(app_client, e) for e in (HEAD, AUD, MGR, EMP))
    everyone = head.get("/api/employees").json()
    assert len(everyone) >= 5 and everyone[0]["ifsc"]
    assert len(aud.get("/api/employees").json()) == len(everyone)
    team = mgr.get("/api/employees").json()
    assert team and all(r["ifsc"] is None for r in team)          # managers never see bank details
    assert len(team) < len(everyone)
    assert emp.get("/api/employees").status_code == 403
    me = head.get("/api/auth/me").json()["user"]
    assert mgr.get(f"/api/employees/{me['id']}").status_code == 404  # outside the manager's reporting line
    detail = head.get(f"/api/employees/{team[0]['id']}").json()
    assert {"employee", "by_month", "by_category", "flags", "recent_claims", "direct_reports", "manager_chain"} <= detail.keys()
