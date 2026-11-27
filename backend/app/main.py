"""ExpenseFlow FastAPI app: API under /api, React build served from FRONTEND_DIST on the same origin."""
from __future__ import annotations

import hashlib
import html
import os
import time
from datetime import date
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from starlette.middleware.sessions import SessionMiddleware

from . import metrics, workflow as wf
from .auth import SESSION_SECRET, USER_SQL, current_user, err, require_roles, verify_password
from .db import Jsonb, audit, connect, get_conn
from .policy import CATEGORIES, DEFAULT_CONFIG

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "uploads"))
FRONTEND_DIST = Path(os.getenv("FRONTEND_DIST", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
MAX_UPLOAD = 5 * 1024 * 1024
ALLOWED_TYPES = {"image/jpeg": b"\xff\xd8\xff", "image/png": b"\x89PNG", "application/pdf": b"%PDF"}

app = FastAPI(title="ExpenseFlow API", version="1.0.0")
app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET, same_site="lax", https_only=False,
                   session_cookie="expenseflow_session", max_age=8 * 3600)


# ------------------------------------------------------------------ middleware & errors
@app.middleware("http")
async def csrf_and_metrics(request: Request, call_next):
    start = time.perf_counter()
    if (request.url.path.startswith("/api/") and request.method not in ("GET", "HEAD", "OPTIONS")
            and request.headers.get("x-requested-with") != "ExpenseFlow"):
        return JSONResponse({"detail": "Missing CSRF header.", "code": "CSRF"}, status_code=403)
    response = await call_next(request)
    route = request.scope.get("route")
    path = getattr(route, "path", None) or ("static" if not request.url.path.startswith("/api") else "unmatched")
    metrics.REQUEST_LATENCY.labels(request.method, path, str(response.status_code)).observe(time.perf_counter() - start)
    if path == "/api/receipts/{receipt_id}":
        response.headers["Content-Security-Policy"] = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    return response


@app.exception_handler(HTTPException)
async def http_error(_request, exc: HTTPException):
    if isinstance(exc.detail, dict):
        return JSONResponse(exc.detail, status_code=exc.status_code)
    return JSONResponse({"detail": str(exc.detail), "code": "HTTP_ERROR"}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def validation_error(_request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    loc = ".".join(str(p) for p in first.get("loc", []) if p != "body")
    return JSONResponse({"detail": f"Invalid input {loc}: {first.get('msg', '')}".strip(), "code": "VALIDATION"},
                        status_code=422)


# ------------------------------------------------------------------ health & metrics
@app.get("/healthz")
def healthz():
    try:
        with connect() as c:
            c.execute("SELECT 1")
        return {"status": "ok", "db": "ok"}
    except Exception:
        return JSONResponse({"status": "degraded", "db": "down"}, status_code=503)


@app.get("/metrics")
def prometheus_metrics(conn=Depends(get_conn)):
    return Response(metrics.render(conn), media_type="text/plain; version=0.0.4")


# ------------------------------------------------------------------ auth
@app.post("/api/auth/login")
def login(body: dict, request: Request, conn=Depends(get_conn)):
    email = str(body.get("email", "")).strip().lower()
    row = conn.execute("SELECT id, password_hash FROM users WHERE lower(email) = %s", (email,)).fetchone()
    if not row or not verify_password(str(body.get("password", "")), row["password_hash"]):
        raise err(401, "BAD_CREDENTIALS", "Email or password is incorrect.")
    request.session.clear()
    request.session["uid"] = row["id"]
    audit(conn, actor_id=row["id"], entity="user", entity_id=row["id"], action="login")
    return {"user": conn.execute(USER_SQL, (row["id"],)).fetchone()}


@app.post("/api/auth/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@app.get("/api/auth/me")
def me(user=Depends(current_user)):
    return {"user": user}


@app.get("/api/demo-users")
def demo_users(conn=Depends(get_conn)):
    return conn.execute("""SELECT u.email, u.name, u.role, d.name AS department FROM users u
                           JOIN departments d ON d.id = u.department_id
                           WHERE u.email LIKE '%%@demo.expenseflow.test' ORDER BY u.id""").fetchall()


@app.get("/api/meta")
def meta(user=Depends(current_user), conn=Depends(get_conn)):
    return {"categories": CATEGORIES,
            "tier1_cities": (conn.execute("SELECT value FROM policy_rules WHERE code='TIER1_CITIES'").fetchone()
                             or {"value": DEFAULT_CONFIG["TIER1_CITIES"]})["value"],
            "policy": policy_rows(conn),
            "departments": [r["name"] for r in conn.execute("SELECT name FROM departments ORDER BY name").fetchall()]}


# ------------------------------------------------------------------ claims
def claim_summary_sql(where: str) -> str:
    return f"""SELECT c.id, c.title, c.status, c.current_step, c.total_paise, c.flags, c.submitted_at, c.updated_at,
                      c.created_at, c.sample_audit, c.auto_approved, c.employee_id, u.name AS employee_name,
                      d.name AS department,
                      (SELECT count(*) FROM claim_lines l WHERE l.claim_id = c.id) AS line_count,
                      round(extract(epoch FROM now() - coalesce(c.step_entered_at, c.submitted_at, c.created_at)) / 3600, 1)::float AS age_hours
               FROM claims c JOIN users u ON u.id = c.employee_id JOIN departments d ON d.id = u.department_id
               WHERE {where}"""


def claim_detail(conn, user, claim_id: int) -> dict:
    claim = wf.load_visible_claim(conn, user, claim_id)
    lines = wf.get_lines(conn, claim_id)
    timeline = conn.execute(
        """SELECT a.at, a.action, a.from_status, a.to_status, a.comment, a.details, u.name AS actor_name,
                  b.name AS on_behalf_of_name
           FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN users b ON b.id = a.on_behalf_of_id
           WHERE a.entity = 'claim' AND a.entity_id = %s ORDER BY a.id""", (claim_id,)).fetchall()
    for ln in lines:
        ln.pop("receipt_sha256", None) if user["role"] == "employee" else None
    return {"claim": {k: v for k, v in claim.items()}, "lines": lines, "timeline": timeline,
            "allowed_actions": wf.allowed_actions(conn, user, claim)}


@app.get("/api/claims")
def my_claims(status: str | None = None, user=Depends(current_user), conn=Depends(get_conn)):
    where, params = "c.employee_id = %s", [user["id"]]
    if status:
        where += " AND c.status = %s"
        params.append(status)
    return conn.execute(claim_summary_sql(where) + " ORDER BY c.updated_at DESC LIMIT 200", params).fetchall()


@app.post("/api/claims")
def create_claim(body: dict, user=Depends(current_user), conn=Depends(get_conn)):
    title = str(body.get("title", "")).strip()[:200] or "Untitled claim"
    cid = conn.execute("INSERT INTO claims (employee_id, title, status) VALUES (%s,%s,'DRAFT') RETURNING id",
                       (user["id"], title)).fetchone()["id"]
    audit(conn, actor_id=user["id"], entity="claim", entity_id=cid, action="create", to_status="DRAFT")
    return claim_detail(conn, user, cid)


@app.get("/api/claims/{claim_id}")
def get_claim(claim_id: int, user=Depends(current_user), conn=Depends(get_conn)):
    return claim_detail(conn, user, claim_id)


@app.put("/api/claims/{claim_id}")
def update_claim(claim_id: int, body: dict, user=Depends(current_user), conn=Depends(get_conn)):
    lines = body.get("lines") or []
    if not isinstance(lines, list):
        raise err(422, "VALIDATION", "lines must be a list.")
    wf.replace_lines(conn, user, claim_id, str(body.get("title", "")), lines)
    return claim_detail(conn, user, claim_id)


@app.post("/api/claims/{claim_id}/submit")
def submit_claim(claim_id: int, user=Depends(current_user), conn=Depends(get_conn)):
    wf.submit(conn, user, claim_id)
    return claim_detail(conn, user, claim_id)


@app.post("/api/claims/{claim_id}/actions")
def claim_action(claim_id: int, body: dict, user=Depends(current_user), conn=Depends(get_conn)):
    wf.act(conn, user, claim_id, str(body.get("action", "")), body.get("comment"))
    return claim_detail(conn, user, claim_id)


# ------------------------------------------------------------------ receipts
@app.post("/api/receipts")
async def upload_receipt(file: UploadFile = File(...), user=Depends(current_user), conn=Depends(get_conn)):
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise err(413, "FILE_TOO_LARGE", "Receipts must be 5 MB or smaller.")
    ctype = next((t for t, magic in ALLOWED_TYPES.items() if data.startswith(magic)), None)
    if not ctype:
        raise err(415, "UNSUPPORTED_TYPE", "Upload a JPG, PNG or PDF receipt.")
    sha = hashlib.sha256(data).hexdigest()
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    path = UPLOAD_DIR / f"{sha}{ {'image/jpeg': '.jpg', 'image/png': '.png', 'application/pdf': '.pdf'}[ctype]}"
    if not path.exists():
        path.write_bytes(data)
    name = Path(file.filename or "receipt").name[:120]
    row = conn.execute("""INSERT INTO receipts (owner_id, filename, content_type, size_bytes, sha256, storage_path)
                          VALUES (%s,%s,%s,%s,%s,%s) RETURNING id, filename, sha256, content_type, size_bytes AS size""",
                       (user["id"], name, ctype, len(data), sha, str(path))).fetchone()
    audit(conn, actor_id=user["id"], entity="receipt", entity_id=row["id"], action="upload", details={"sha256": sha})
    return row


def synthetic_receipt_svg(r: dict) -> str:
    e = html.escape
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="360" height="480" viewBox="0 0 360 480">
<rect width="360" height="480" fill="#fffdf7" stroke="#999"/><text x="24" y="48" font-family="monospace" font-size="20">SYNTHETIC RECEIPT</text>
<text x="24" y="96" font-family="monospace" font-size="16">{e(r.get('vendor') or '')}</text>
<text x="24" y="130" font-family="monospace" font-size="16">Date: {e(str(r.get('expense_date') or ''))}</text>
<text x="24" y="164" font-family="monospace" font-size="16">Category: {e(r.get('category') or '')}</text>
<text x="24" y="230" font-family="monospace" font-size="24">TOTAL INR {(r.get('amount_paise') or 0) / 100:,.2f}</text>
<text x="24" y="440" font-family="monospace" font-size="12">{e(r['filename'])} · demo data only</text></svg>"""


@app.get("/api/receipts/{receipt_id}")
def get_receipt(receipt_id: int, user=Depends(current_user), conn=Depends(get_conn)):
    r = conn.execute("SELECT * FROM receipts WHERE id = %s", (receipt_id,)).fetchone()
    if not r:
        raise err(404, "NOT_FOUND", "Receipt not found.")
    allowed = r["owner_id"] == user["id"] or user["role"] in ("auditor", "head")
    line = conn.execute("""SELECT l.claim_id, l.vendor, l.expense_date, l.category, l.amount_paise FROM claim_lines l
                           WHERE l.receipt_id = %s ORDER BY l.id LIMIT 1""", (receipt_id,)).fetchone()
    if not allowed and line:
        allowed = wf.can_view(conn, user, wf.get_claim(conn, line["claim_id"]))
    if not allowed:
        raise err(404, "NOT_FOUND", "Receipt not found.")
    if r["storage_path"].startswith("synthetic:"):
        return Response(synthetic_receipt_svg({**(line or {}), "filename": r["filename"]}), media_type="image/svg+xml")
    p = Path(r["storage_path"])
    if not p.exists():
        raise err(404, "FILE_MISSING", "Receipt file is missing from storage.")
    return FileResponse(p, media_type=r["content_type"], filename=r["filename"], content_disposition_type="inline")


# ------------------------------------------------------------------ approvals
def actionable_claims(conn, user, extra_where="TRUE", params=()) -> list[dict]:
    """Claims where user can act now (directly or via delegation), oldest first."""
    delegators = wf.active_delegators(conn, user["id"])
    mgr_ids = [user["id"]] + [d["id"] for d in delegators]
    roles = {user["role"]} | {d["role"] for d in delegators}
    conds = ["(c.status = 'PENDING_APPROVAL' AND c.current_step = 'MANAGER' AND u.manager_id = ANY(%s))"]
    p: list = [mgr_ids]
    if "auditor" in roles:
        conds.append("(c.status = 'PENDING_APPROVAL' AND c.current_step = 'AUDITOR')")
        conds.append("(c.status = 'SAMPLE_AUDIT')")
    if "head" in roles:
        conds.append("(c.status = 'PENDING_APPROVAL' AND c.current_step = 'HEAD')")
    where = f"({' OR '.join(conds)}) AND c.employee_id <> %s AND {extra_where}"
    return conn.execute(claim_summary_sql(where) + " ORDER BY coalesce(c.step_entered_at, c.submitted_at) ASC LIMIT 500",
                        (*p, user["id"], *params)).fetchall()


@app.get("/api/approvals/inbox")
def inbox(user=Depends(current_user), conn=Depends(get_conn)):
    return actionable_claims(conn, user)


@app.post("/api/approvals/bulk")
def bulk_approve(body: dict, user=Depends(require_roles("auditor", "head")), conn=Depends(get_conn)):
    if body.get("action", "approve") != "approve":
        raise err(422, "INVALID_ACTION", "Bulk action supports approve only.")
    results = []
    for cid in (body.get("claim_ids") or [])[:200]:
        conn.execute("SAVEPOINT bulk")
        try:
            claim = wf.get_claim(conn, int(cid))
            action = "clear" if claim["status"] == "SAMPLE_AUDIT" else "approve"
            wf.act(conn, user, int(cid), action, body.get("comment") or "Bulk approved")
            conn.execute("RELEASE SAVEPOINT bulk")
            results.append({"claim_id": cid, "ok": True, "status": wf.get_claim(conn, int(cid))["status"], "error": None})
        except HTTPException as e:
            conn.execute("ROLLBACK TO SAVEPOINT bulk")
            results.append({"claim_id": cid, "ok": False, "status": None,
                            "error": e.detail.get("detail") if isinstance(e.detail, dict) else str(e.detail)})
    return {"results": results}


@app.get("/api/audit/queue")
def audit_queue(kind: str = "all", department: str | None = None, category: str | None = None, flag: str | None = None,
                min_paise: int | None = None, max_paise: int | None = None, q: str | None = None,
                user=Depends(require_roles("auditor", "head")), conn=Depends(get_conn)):
    where, params = ["TRUE"], []
    if kind == "auditor_step":
        where.append("c.status = 'PENDING_APPROVAL' AND c.current_step = 'AUDITOR'")
    elif kind == "sample_audit":
        where.append("c.status = 'SAMPLE_AUDIT'")
    elif kind == "head_step":
        where.append("c.status = 'PENDING_APPROVAL' AND c.current_step = 'HEAD'")
    if department:
        where.append("d.name = %s"); params.append(department)
    if category:
        where.append("EXISTS (SELECT 1 FROM claim_lines l WHERE l.claim_id = c.id AND l.category = %s)"); params.append(category)
    if flag:
        where.append("%s = ANY(c.flags)"); params.append(flag)
    if min_paise is not None:
        where.append("c.total_paise >= %s"); params.append(min_paise)
    if max_paise is not None:
        where.append("c.total_paise <= %s"); params.append(max_paise)
    if q:
        where.append("(u.name ILIKE %s OR c.title ILIKE %s OR c.id::text = %s)"); params += [f"%{q}%", f"%{q}%", q]
    if kind == "all_pending":
        # Oversight view (added after SRE drill RCA): every pending claim at any step, oldest first, read-only.
        where.append("c.status IN ('PENDING_APPROVAL','SAMPLE_AUDIT')")
        return conn.execute(claim_summary_sql(" AND ".join(where)) +
                            " ORDER BY coalesce(c.step_entered_at, c.submitted_at) ASC LIMIT 500", params).fetchall()
    return actionable_claims(conn, user, " AND ".join(where), tuple(params))


# ------------------------------------------------------------------ delegations
@app.get("/api/delegations")
def list_delegations(user=Depends(current_user), conn=Depends(get_conn)):
    return conn.execute("""SELECT g.*, a.name AS delegator_name, b.name AS delegate_name,
                                  (current_date BETWEEN g.start_date AND g.end_date) AS active
                           FROM delegations g JOIN users a ON a.id = g.delegator_id JOIN users b ON b.id = g.delegate_id
                           WHERE g.delegator_id = %s OR g.delegate_id = %s ORDER BY g.start_date DESC""",
                        (user["id"], user["id"])).fetchall()


@app.post("/api/delegations")
def create_delegation(body: dict, user=Depends(current_user), conn=Depends(get_conn)):
    if not (user["is_manager"] or user["role"] in ("manager", "auditor", "head")):
        raise err(403, "FORBIDDEN_ROLE", "Only approvers can delegate.")
    try:
        delegate_id = int(body.get("delegate_id"))
        start, end = date.fromisoformat(body.get("start_date")), date.fromisoformat(body.get("end_date"))
    except (TypeError, ValueError):
        raise err(422, "VALIDATION", "Choose a delegate and a valid date range.")
    if delegate_id == user["id"]:
        raise err(422, "SELF_DELEGATION", "You cannot delegate to yourself.")
    if end < start:
        raise err(422, "VALIDATION", "End date must be on or after the start date.")
    if not conn.execute("SELECT 1 FROM users WHERE id=%s", (delegate_id,)).fetchone():
        raise err(422, "VALIDATION", "Delegate not found.")
    row = conn.execute("""INSERT INTO delegations (delegator_id, delegate_id, start_date, end_date)
                          VALUES (%s,%s,%s,%s) RETURNING *""", (user["id"], delegate_id, start, end)).fetchone()
    audit(conn, actor_id=user["id"], entity="delegation", entity_id=row["id"], action="create",
          details={"delegate_id": delegate_id, "start": str(start), "end": str(end)})
    return row


@app.delete("/api/delegations/{delegation_id}")
def delete_delegation(delegation_id: int, user=Depends(current_user), conn=Depends(get_conn)):
    row = conn.execute("DELETE FROM delegations WHERE id=%s AND delegator_id=%s RETURNING id",
                       (delegation_id, user["id"])).fetchone()
    if not row:
        raise err(404, "NOT_FOUND", "Delegation not found.")
    audit(conn, actor_id=user["id"], entity="delegation", entity_id=delegation_id, action="delete")
    return {"ok": True}


@app.get("/api/users/approvers")
def approvers(user=Depends(current_user), conn=Depends(get_conn)):
    return conn.execute("""SELECT u.id, u.name, u.role, d.name AS department FROM users u JOIN departments d ON d.id=u.department_id
                           WHERE u.id <> %s AND (u.role IN ('manager','auditor','head')
                                 OR EXISTS (SELECT 1 FROM users r WHERE r.manager_id = u.id))
                           ORDER BY u.role, u.name""", (user["id"],)).fetchall()


# ------------------------------------------------------------------ payouts
@app.get("/api/payouts/eligible")
def payout_eligible(user=Depends(require_roles("head")), conn=Depends(get_conn)):
    return conn.execute(claim_summary_sql("c.status = 'APPROVED'") + " ORDER BY c.decided_at LIMIT 500").fetchall()


@app.post("/api/payouts")
def create_payout(body: dict, user=Depends(require_roles("head")), conn=Depends(get_conn)):
    bid = wf.create_batch(conn, user, body.get("claim_ids") or [])
    return payout_detail(bid, user, conn)


@app.get("/api/payouts")
def list_payouts(user=Depends(require_roles("head")), conn=Depends(get_conn)):
    return conn.execute("""SELECT b.*, u.name AS created_by_name FROM payout_batches b JOIN users u ON u.id = b.created_by
                           ORDER BY b.id DESC LIMIT 100""").fetchall()


@app.get("/api/payouts/{batch_id}")
def payout_detail(batch_id: int, user=Depends(require_roles("head")), conn=Depends(get_conn)):
    b = conn.execute("SELECT * FROM payout_batches WHERE id=%s", (batch_id,)).fetchone()
    if not b:
        raise err(404, "NOT_FOUND", "Batch not found.")
    items = conn.execute("""SELECT p.*, c.title, c.status, u.name AS employee_name FROM payout_items p
                            JOIN claims c ON c.id = p.claim_id JOIN users u ON u.id = c.employee_id
                            WHERE p.batch_id = %s ORDER BY p.line_no""", (batch_id,)).fetchall()
    return {**b, "items": items}


@app.get("/api/payouts/{batch_id}/csv")
def payout_csv(batch_id: int, user=Depends(require_roles("head")), conn=Depends(get_conn)):
    if not conn.execute("SELECT 1 FROM payout_batches WHERE id=%s", (batch_id,)).fetchone():
        raise err(404, "NOT_FOUND", "Batch not found.")
    audit(conn, actor_id=user["id"], entity="payout_batch", entity_id=batch_id, action="export_csv")
    return PlainTextResponse(wf.batch_csv(conn, batch_id), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="payout-batch-{batch_id}.csv"'})


@app.post("/api/payouts/{batch_id}/mark-paid")
def payout_mark_paid(batch_id: int, user=Depends(require_roles("head")), conn=Depends(get_conn)):
    wf.mark_paid(conn, user, batch_id)
    return payout_detail(batch_id, user, conn)


# ------------------------------------------------------------------ dashboard & audit log & policy
SPEND_STATUSES = ("APPROVED", "IN_PAYOUT", "PAID")


@app.get("/api/dashboard")
def dashboard(months: int = 6, user=Depends(require_roles("auditor", "head")), conn=Depends(get_conn)):
    months = max(1, min(months, 24))
    st = list(SPEND_STATUSES)
    kpis = conn.execute(
        """SELECT coalesce(sum(total_paise) FILTER (WHERE status = ANY(%s)), 0)::bigint AS total_spend_paise,
                  count(*) FILTER (WHERE status <> 'DRAFT') AS claims,
                  count(*) FILTER (WHERE status IN ('PENDING_APPROVAL','SAMPLE_AUDIT')) AS pending,
                  coalesce(round((avg(extract(epoch FROM decided_at - submitted_at)/3600)
                      FILTER (WHERE NOT auto_approved AND decided_at IS NOT NULL AND status <> 'AUTO_REJECTED'))::numeric, 1), 0)::float AS avg_approval_hours,
                  count(*) FILTER (WHERE cardinality(flags) > 0) AS violation_count,
                  coalesce(round((extract(epoch FROM now() - min(step_entered_at) FILTER (WHERE status='PENDING_APPROVAL'))/3600)::numeric, 1), 0)::float AS oldest_pending_hours
           FROM claims""", (st,)).fetchone()
    by_category = conn.execute(
        """SELECT l.category AS label, sum(l.amount_paise)::bigint AS value FROM claim_lines l JOIN claims c ON c.id=l.claim_id
           WHERE c.status = ANY(%s) GROUP BY 1 ORDER BY 2 DESC""", (st,)).fetchall()
    by_department = conn.execute(
        """SELECT d.name AS label, sum(c.total_paise)::bigint AS value FROM claims c JOIN users u ON u.id=c.employee_id
           JOIN departments d ON d.id=u.department_id WHERE c.status = ANY(%s) GROUP BY 1 ORDER BY 2 DESC""", (st,)).fetchall()
    by_month = conn.execute(
        """SELECT to_char(date_trunc('month', c.submitted_at AT TIME ZONE 'Asia/Kolkata'), 'YYYY-MM') AS label,
                  sum(c.total_paise)::bigint AS value
           FROM claims c WHERE c.status = ANY(%s) AND c.submitted_at >= date_trunc('month', now()) - make_interval(months => %s)
           GROUP BY 1 ORDER BY 1""", (st, months - 1)).fetchall()
    violations = conn.execute(
        """SELECT f AS label, count(*)::int AS value FROM claims c, unnest(c.flags) AS f
           WHERE c.status <> 'DRAFT' GROUP BY 1 ORDER BY 2 DESC""").fetchall()
    return {"kpis": kpis, "by_category": by_category, "by_department": by_department, "by_month": by_month,
            "violations_by_rule": violations}


@app.get("/api/audit-log")
def audit_log(claim_id: int | None = None, limit: int = 100, user=Depends(require_roles("auditor", "head")),
              conn=Depends(get_conn)):
    limit = max(1, min(limit, 500))
    where, params = "TRUE", []
    if claim_id:
        where, params = "a.entity='claim' AND a.entity_id=%s", [claim_id]
    return conn.execute(f"""SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id
                            WHERE {where} ORDER BY a.id DESC LIMIT %s""", (*params, limit)).fetchall()


def policy_rows(conn):
    return conn.execute("SELECT code, description, value, outcome, updated_at FROM policy_rules ORDER BY code").fetchall()


@app.get("/api/policy")
def get_policy(user=Depends(current_user), conn=Depends(get_conn)):
    return policy_rows(conn)


@app.put("/api/policy/{code}")
def put_policy(code: str, body: dict, user=Depends(require_roles("head")), conn=Depends(get_conn)):
    old = conn.execute("SELECT value FROM policy_rules WHERE code=%s FOR UPDATE", (code,)).fetchone()
    if not old:
        raise err(404, "NOT_FOUND", "Unknown policy rule.")
    value = body.get("value")
    if isinstance(old["value"], list):
        if not isinstance(value, list) or not all(isinstance(v, str) and v.strip() for v in value):
            raise err(422, "VALIDATION", "Provide a list of city names.")
    elif not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise err(422, "VALIDATION", "Value must be a non-negative whole number (paise, percent or 0/1).")
    conn.execute("UPDATE policy_rules SET value=%s, updated_at=now(), updated_by=%s WHERE code=%s",
                 (Jsonb(value), user["id"], code))
    audit(conn, actor_id=user["id"], entity="policy_rule", entity_id=None, action="update",
          details={"code": code, "old": old["value"], "new": value})
    return conn.execute("SELECT code, description, value, outcome, updated_at FROM policy_rules WHERE code=%s",
                        (code,)).fetchone()


# ------------------------------------------------------------------ SPA (same origin)
@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str):
    if full_path.startswith("api/"):
        raise err(404, "NOT_FOUND", "Unknown API route.")
    if FRONTEND_DIST.exists():
        target = (FRONTEND_DIST / full_path).resolve()
        if full_path and target.is_file() and FRONTEND_DIST.resolve() in target.parents:
            return FileResponse(target)
        index = FRONTEND_DIST / "index.html"
        if index.exists():
            return FileResponse(index)
    return PlainTextResponse("ExpenseFlow API is running. Frontend build not found.", status_code=200)
