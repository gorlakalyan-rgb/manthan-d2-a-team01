"""Execute the 10 written E2E cases from submission/test-plan.md against the running stack (API level).

python ops/e2e_cases.py  -> prints a result table and writes submission/test-evidence/e2e-cases-results.csv
UI-level coverage of the same flows is in frontend/e2e (Playwright).
"""
import csv
import random
import time
from datetime import date, timedelta
from pathlib import Path

import httpx

APP = "http://localhost:8080"
H = {"X-Requested-With": "ExpenseFlow"}
OUT = Path(__file__).resolve().parents[1] / "submission" / "test-evidence" / "e2e-cases-results.csv"
RUN = f"{int(time.time())}-{random.randint(1000, 9999)}"
results = []


def wd(back=2):
    d = date.today() - timedelta(days=back)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return str(d)


def login(who):
    c = httpx.Client(base_url=APP, headers=H, timeout=30)
    c.post("/api/auth/login", json={"email": f"{who}@demo.expenseflow.test", "password": "demo123"}).raise_for_status()
    return c


def rcpt(c, tag, kind="pdf"):
    data = (b"%PDF-1.4\n" if kind == "pdf" else b"\x89PNG\r\n\x1a\n") + f"{RUN}-{tag}".encode()
    return c.post("/api/receipts", files={"file": (f"{tag}.{kind}", data)}).json()["id"]


def claim(c, title, lines):
    cid = c.post("/api/claims", json={"title": title}).json()["claim"]["id"]
    r = c.put(f"/api/claims/{cid}", json={"title": title, "lines": lines})
    assert r.status_code == 200, r.text
    return cid


def submit(c, cid):
    return c.post(f"/api/claims/{cid}/submit").json()


def act(c, cid, action, comment="ok"):
    return c.post(f"/api/claims/{cid}/actions", json={"action": action, "comment": comment})


def case(cid, title):
    def deco(fn):
        try:
            evidence = fn()
            results.append((cid, title, "PASS", evidence))
        except AssertionError as e:
            results.append((cid, title, "FAIL", str(e)))
        except Exception as e:  # noqa
            results.append((cid, title, "ERROR", repr(e)[:200]))
        return fn
    return deco


E, M, A, HD = (login(x) for x in ("employee", "manager", "auditor", "head"))


@case("E2E-01", "Clean small claim auto-approves")
def _():
    cid = claim(E, "Stationery", [{"category": "office_supplies", "amount_paise": 45000, "expense_date": wd(), "vendor": f"Staples {RUN}"}])
    c = submit(E, cid)["claim"]
    assert c["status"] in ("APPROVED", "SAMPLE_AUDIT") and c["flags"] == [], c
    return f"claim {cid} -> {c['status']}, no flags"


@case("E2E-02", "Missing receipt auto-rejects, fix and resubmit")
def _():
    ln = {"category": "local_cab", "amount_paise": 72000, "expense_date": wd(), "vendor": f"Ola {RUN}"}
    cid = claim(E, "Cab no receipt", [ln])
    c = submit(E, cid)["claim"]
    assert c["status"] == "AUTO_REJECTED" and "RECEIPT_REQUIRED_ABOVE" in c["flags"], c
    claim_put = E.put(f"/api/claims/{cid}", json={"title": "Cab with receipt", "lines": [{**ln, "receipt_id": rcpt(E, "e2e02")}]})
    assert claim_put.status_code == 200
    c2 = submit(E, cid)["claim"]
    assert c2["status"] != "AUTO_REJECTED", c2
    return f"claim {cid}: AUTO_REJECTED -> {c2['status']} after receipt added"


@case("E2E-03", "Thinnest slice: routed claim to Paid (with CSV)")
def _():
    cid = claim(E, "Pune client visit", [
        {"category": "hotel", "amount_paise": 2800000, "expense_date": wd(3), "vendor": f"Taj Pune {RUN}", "city": "Pune", "nights": 4, "receipt_id": rcpt(E, "e2e03h")},
        {"category": "meals", "amount_paise": 90000, "expense_date": wd(4), "vendor": f"MTR {RUN}", "receipt_id": rcpt(E, "e2e03m")}])
    c = submit(E, cid)["claim"]
    assert "HOTEL_NIGHT_LIMIT_TIER1" in c["flags"] and c["current_step"] == "MANAGER", c
    assert act(M, cid, "approve").json()["claim"]["current_step"] == "AUDITOR"
    assert act(A, cid, "approve").json()["claim"]["status"] == "APPROVED"
    b = HD.post("/api/payouts", json={"claim_ids": [cid]}).json()
    csv_text = HD.get(f"/api/payouts/{b['id']}/csv").text
    assert ",28900.00," in csv_text, csv_text
    HD.post(f"/api/payouts/{b['id']}/mark-paid").raise_for_status()
    final = E.get(f"/api/claims/{cid}").json()
    assert final["claim"]["status"] == "PAID"
    return f"claim {cid} MANAGER->AUDITOR->APPROVED->batch {b['id']}->PAID; CSV amount 28900.00; {len(final['timeline'])} timeline entries"


@case("E2E-04", "Claim above 1,00,000 needs head")
def _():
    cid = claim(E, "Intl conference", [{"category": "airfare", "amount_paise": 12000000, "expense_date": wd(), "vendor": f"Air India {RUN}", "receipt_id": rcpt(E, "e2e04")}])
    submit(E, cid)
    act(M, cid, "approve"); c = act(A, cid, "approve").json()["claim"]
    assert c["status"] == "PENDING_APPROVAL" and c["current_step"] == "HEAD", c
    assert any(x["id"] == cid for x in HD.get("/api/approvals/inbox").json())
    assert act(HD, cid, "approve").json()["claim"]["status"] == "APPROVED"
    return f"claim {cid}: at HEAD after auditor, in head inbox, APPROVED after head"


@case("E2E-05", "Send back restarts the chain")
def _():
    ln = {"category": "airfare", "amount_paise": 3000000, "expense_date": wd(), "vendor": f"IndiGo {RUN}", "receipt_id": rcpt(E, "e2e05")}
    cid = claim(E, "Delhi trip", [ln]); submit(E, cid); act(M, cid, "approve")
    c = act(A, cid, "send_back", "Attach boarding pass").json()
    assert c["claim"]["status"] == "NEEDS_CLARIFICATION" and c["timeline"][-1]["comment"] == "Attach boarding pass"
    E.put(f"/api/claims/{cid}", json={"title": "Delhi trip", "lines": [{**ln, "description": "boarding pass attached"}]})
    c2 = submit(E, cid)["claim"]
    assert c2["current_step"] == "MANAGER", c2
    return f"claim {cid}: NEEDS_CLARIFICATION with comment; resubmit restarts at MANAGER"


@case("E2E-06", "Delegate approves on behalf of manager")
def _():
    a_id = A.get("/api/auth/me").json()["user"]["id"]
    d = M.post("/api/delegations", json={"delegate_id": a_id, "start_date": str(date.today()), "end_date": str(date.today() + timedelta(days=5))}).json()
    try:
        cid = claim(E, "Cab over limit", [{"category": "local_cab", "amount_paise": 250000, "expense_date": wd(), "vendor": f"Uber {RUN}", "receipt_id": rcpt(E, "e2e06")}])
        submit(E, cid)
        assert any(x["id"] == cid for x in A.get("/api/approvals/inbox").json())
        body = act(A, cid, "approve").json()
        t = body["timeline"][-1]
        assert t["actor_name"] == "Arun Auditor" and t["on_behalf_of_name"] == "Maya Manager", t
        return f"claim {cid}: approved by {t['actor_name']} on behalf of {t['on_behalf_of_name']}"
    finally:
        M.delete(f"/api/delegations/{d['id']}")


@case("E2E-07", "Manager cannot approve own claim")
def _():
    cid = claim(M, "Manager travel", [{"category": "airfare", "amount_paise": 3000000, "expense_date": wd(), "vendor": f"Akasa {RUN}", "receipt_id": rcpt(M, "e2e07")}])
    submit(M, cid)
    assert not any(x["id"] == cid for x in M.get("/api/approvals/inbox").json())
    assert "approve" not in M.get(f"/api/claims/{cid}").json()["allowed_actions"]
    r = act(M, cid, "approve")
    assert r.status_code == 403 and r.json()["code"] == "SELF_APPROVAL", r.text
    return f"claim {cid}: not in own inbox, no approve action, API 403 SELF_APPROVAL"


@case("E2E-08", "Reused receipt is auto-rejected")
def _():
    data = b"%PDF-1.4\n" + f"{RUN}-shared".encode()
    r1 = E.post("/api/receipts", files={"file": ("a.pdf", data)}).json()["id"]
    submit(E, claim(E, "First use", [{"category": "train", "amount_paise": 120000, "expense_date": wd(), "vendor": f"IRCTC {RUN}a", "receipt_id": r1}]))
    r2 = E.post("/api/receipts", files={"file": ("b.pdf", data)}).json()["id"]
    c = submit(E, claim(E, "Second use", [{"category": "train", "amount_paise": 130000, "expense_date": wd(), "vendor": f"IRCTC {RUN}b", "receipt_id": r2}]))["claim"]
    assert c["status"] == "AUTO_REJECTED" and "DUPLICATE_RECEIPT_HASH" in c["flags"], c
    return f"claim {c['id']}: AUTO_REJECTED DUPLICATE_RECEIPT_HASH"


@case("E2E-09", "Auditor filters queue and bulk approves; clears a sample")
def _():
    ids = []
    for i in range(3):
        cid = claim(E, f"Bulk {i}", [{"category": "airfare", "amount_paise": 2600000 + i, "expense_date": wd(), "vendor": f"SpiceJet {RUN}{i}", "receipt_id": rcpt(E, f"e2e09{i}")}])
        submit(E, cid); act(M, cid, "approve"); ids.append(cid)
    rows = A.get("/api/audit/queue", params={"kind": "auditor_step", "department": "Engineering", "flag": "AUTO_APPROVE_MAX_TOTAL"}).json()
    assert set(ids) <= {r["id"] for r in rows}
    res = A.post("/api/approvals/bulk", json={"claim_ids": ids, "action": "approve", "comment": "bulk"}).json()["results"]
    assert all(r["ok"] and r["status"] == "APPROVED" for r in res), res
    samples = A.get("/api/audit/queue", params={"kind": "sample_audit"}).json()
    sid = samples[0]["id"]
    assert act(A, sid, "clear").json()["claim"]["status"] == "APPROVED"
    assert any(x["id"] == sid for x in HD.get("/api/payouts/eligible").json())
    return f"filtered queue had {len(rows)} rows; bulk approved {ids}; sample {sid} cleared and payable"


@case("E2E-10", "Employee sees only own claims; finance dashboard")
def _():
    me = E.get("/api/auth/me").json()["user"]["id"]
    mine = E.get("/api/claims").json()
    assert all(x["employee_id"] == me for x in mine)
    other = M.get("/api/claims").json()[0]["id"]
    assert E.get(f"/api/claims/{other}").status_code == 404
    d = HD.get("/api/dashboard").json()
    assert d["kpis"]["avg_approval_hours"] > 0 and d["by_month"] and d["violations_by_rule"]
    return f"{len(mine)} own claims only; colleague claim 404; dashboard KPIs ok"


OUT.parent.mkdir(parents=True, exist_ok=True)
with OUT.open("w", newline="", encoding="utf-8") as f:
    w = csv.writer(f); w.writerow(["case_id", "title", "result", "evidence"]); w.writerows(results)
for r in results:
    print(f"{r[0]:7} {r[2]:5} {r[1]} — {r[3]}")
print(f"{sum(r[2] == 'PASS' for r in results)}/{len(results)} passed")
