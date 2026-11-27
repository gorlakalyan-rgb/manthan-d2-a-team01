"""Claim state machine, approver resolution, delegation, submit/approve/payout services.

Every transition is a conditional UPDATE on (status, current_step); 0 rows => 409 (someone else acted first).
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from .auth import err
from .db import Jsonb, audit, load_policy
from .policy import CATEGORIES, PolicyContext, evaluate_claim, is_sampled, norm_vendor, required_steps
from . import metrics

EDITABLE = ("DRAFT", "NEEDS_CLARIFICATION", "AUTO_REJECTED")
NOT_COUNTED = ("DRAFT", "AUTO_REJECTED", "REJECTED")
MAX_LINE_PAISE = 100_000_000


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def today() -> date:
    return now_utc().date()


# ---------------------------------------------------------------- loading
def get_claim(conn, claim_id: int, for_update: bool = False) -> dict:
    sql = """SELECT c.*, u.name AS employee_name, u.manager_id AS employee_manager_id, u.role AS employee_role,
                    d.name AS department
             FROM claims c JOIN users u ON u.id = c.employee_id JOIN departments d ON d.id = u.department_id
             WHERE c.id = %s"""
    if for_update:
        sql += " FOR UPDATE OF c"
    claim = conn.execute(sql, (claim_id,)).fetchone()
    if not claim:
        raise err(404, "NOT_FOUND", "Claim not found.")
    return claim


def get_lines(conn, claim_id: int) -> list[dict]:
    return conn.execute(
        """SELECT l.*, r.sha256 AS receipt_sha256, r.filename AS receipt_filename, r.content_type AS receipt_content_type
           FROM claim_lines l LEFT JOIN receipts r ON r.id = l.receipt_id
           WHERE l.claim_id = %s ORDER BY l.line_no""", (claim_id,)).fetchall()


# ---------------------------------------------------------------- delegation / approvers
def active_delegators(conn, user_id: int, on: date | None = None) -> list[dict]:
    """Users who have delegated to user_id for the given day."""
    on = on or today()
    return conn.execute(
        """SELECT u.id, u.role FROM delegations g JOIN users u ON u.id = g.delegator_id
           WHERE g.delegate_id = %s AND %s BETWEEN g.start_date AND g.end_date""", (user_id, on)).fetchall()


def acting_identity(conn, user: dict, claim: dict) -> tuple[bool, int | None]:
    """Can `user` act on the claim's current step? Returns (allowed, on_behalf_of_id)."""
    if user["id"] == claim["employee_id"]:
        return False, None                      # never on your own claim, even as a delegate
    status, step = claim["status"], claim["current_step"]
    if status == "PENDING_APPROVAL":
        if step == "MANAGER":
            mgr = claim["employee_manager_id"]
            if user["id"] == mgr:
                return True, None
            for d in active_delegators(conn, user["id"]):
                if d["id"] == mgr:
                    return True, mgr
            return False, None
        role_needed = {"AUDITOR": "auditor", "HEAD": "head"}[step]
    elif status == "SAMPLE_AUDIT":
        role_needed = "auditor"
    else:
        return False, None
    if user["role"] == role_needed:
        return True, None
    for d in active_delegators(conn, user["id"]):
        if d["role"] == role_needed and d["id"] != claim["employee_id"]:
            return True, d["id"]
    return False, None


def can_view(conn, user: dict, claim: dict) -> bool:
    if user["id"] == claim["employee_id"] or user["role"] in ("auditor", "head"):
        return True
    if user["id"] == claim["employee_manager_id"]:
        return True
    if any(d["id"] == claim["employee_manager_id"] for d in active_delegators(conn, user["id"])):
        return True
    return acting_identity(conn, user, claim)[0]


def load_visible_claim(conn, user, claim_id, for_update=False) -> dict:
    claim = get_claim(conn, claim_id, for_update)
    if not can_view(conn, user, claim):
        raise err(404, "NOT_FOUND", "Claim not found.")   # don't leak existence
    return claim


def allowed_actions(conn, user, claim) -> list[str]:
    acts = []
    if user["id"] == claim["employee_id"] and claim["status"] in EDITABLE:
        acts += ["edit", "submit"]
    ok, _ = acting_identity(conn, user, claim)
    if ok:
        acts += ["approve", "reject", "send_back"] if claim["status"] == "PENDING_APPROVAL" else ["clear", "reject"]
    return acts


def plan_steps(conn, claim: dict, total: int, cfg: dict) -> list[str]:
    steps = required_steps(total, cfg)
    if not claim["employee_manager_id"]:
        steps = [s for s in steps if s != "MANAGER"]
        if "AUDITOR" not in steps:
            steps.insert(0, "AUDITOR")
    if "HEAD" in steps and claim["employee_role"] == "head":
        other_heads = conn.execute("SELECT count(*) AS n FROM users WHERE role='head' AND id <> %s",
                                   (claim["employee_id"],)).fetchone()["n"]
        if not other_heads:
            steps.remove("HEAD")
    return steps


# ---------------------------------------------------------------- transitions
def transition(conn, claim, to_status, *, actor_id, action, comment=None, on_behalf_of_id=None,
               current_step=None, extra_sets: dict | None = None, details=None) -> None:
    sets = {"status": to_status, "current_step": current_step, "updated_at": now_utc()}
    if to_status == "PENDING_APPROVAL":
        sets["step_entered_at"] = now_utc()
    sets.update(extra_sets or {})
    cols = ", ".join(f"{k} = %s" for k in sets)
    row = conn.execute(
        f"UPDATE claims SET {cols} WHERE id = %s AND status = %s AND current_step IS NOT DISTINCT FROM %s RETURNING id",
        (*sets.values(), claim["id"], claim["status"], claim["current_step"])).fetchone()
    if not row:
        raise err(409, "STALE_STATE", "This claim was changed by someone else. Refresh and try again.")
    audit(conn, actor_id=actor_id, on_behalf_of_id=on_behalf_of_id, entity="claim", entity_id=claim["id"],
          action=action, from_status=claim["status"] + (f":{claim['current_step']}" if claim["current_step"] else ""),
          to_status=to_status + (f":{current_step}" if current_step else ""), comment=comment, details=details)
    metrics.CLAIM_TRANSITIONS.labels(to_status=to_status).inc()


# ---------------------------------------------------------------- editing
def validate_line(ln: dict, idx: int) -> dict:
    def bad(msg):
        raise err(422, "INVALID_LINE", f"Line {idx + 1}: {msg}")
    cat = ln.get("category")
    if cat not in CATEGORIES:
        bad("choose a valid category.")
    try:
        amt = int(ln.get("amount_paise"))
    except (TypeError, ValueError):
        bad("amount is required.")
    if amt <= 0 or amt > MAX_LINE_PAISE:
        bad("amount must be between ₹0.01 and ₹10,00,000.")
    try:
        d = date.fromisoformat(str(ln.get("expense_date")))
    except ValueError:
        bad("date is required (YYYY-MM-DD).")
    if d > today():
        bad("date cannot be in the future.")
    if d < today() - timedelta(days=365):
        bad("expenses older than 365 days cannot be claimed.")
    vendor = (ln.get("vendor") or "").strip()
    if not vendor:
        bad("vendor is required.")
    city = (ln.get("city") or "").strip() or None
    nights = ln.get("nights")
    if cat == "hotel":
        if not city:
            bad("hotel lines need a city.")
        try:
            nights = int(nights)
        except (TypeError, ValueError):
            bad("hotel lines need the number of nights.")
        if nights < 1 or nights > 60:
            bad("nights must be between 1 and 60.")
    else:
        nights = None
    rid = ln.get("receipt_id")
    return {"category": cat, "amount_paise": amt, "expense_date": d, "vendor": vendor[:120], "city": city,
            "nights": nights, "description": (ln.get("description") or "")[:500], "receipt_id": int(rid) if rid else None}


def replace_lines(conn, user, claim_id: int, title: str, lines: list[dict]) -> None:
    claim = load_visible_claim(conn, user, claim_id, for_update=True)
    if claim["employee_id"] != user["id"]:
        raise err(403, "NOT_OWNER", "Only the claimant can edit this claim.")
    if claim["status"] not in EDITABLE:
        raise err(409, "NOT_EDITABLE", f"A claim in status {claim['status']} cannot be edited.")
    title = (title or "").strip()
    if not title:
        raise err(422, "INVALID_TITLE", "Give the claim a title.")
    if len(lines) > 50:
        raise err(422, "TOO_MANY_LINES", "A claim can have at most 50 lines.")
    clean = [validate_line(ln, i) for i, ln in enumerate(lines)]
    rids = [c["receipt_id"] for c in clean if c["receipt_id"]]
    if rids:
        owned = {r["id"] for r in conn.execute("SELECT id FROM receipts WHERE id = ANY(%s) AND owner_id = %s",
                                                (rids, user["id"])).fetchall()}
        if set(rids) - owned:
            raise err(422, "INVALID_RECEIPT", "One of the receipts was not uploaded by you.")
    conn.execute("DELETE FROM claim_lines WHERE claim_id = %s", (claim_id,))
    for i, c in enumerate(clean, 1):
        conn.execute("""INSERT INTO claim_lines (claim_id, line_no, category, amount_paise, expense_date, vendor, city,
                        nights, description, receipt_id) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                     (claim_id, i, c["category"], c["amount_paise"], c["expense_date"], c["vendor"], c["city"],
                      c["nights"], c["description"], c["receipt_id"]))
    total = sum(c["amount_paise"] for c in clean)
    conn.execute("UPDATE claims SET title=%s, total_paise=%s, updated_at=now() WHERE id=%s", (title, total, claim_id))
    audit(conn, actor_id=user["id"], entity="claim", entity_id=claim_id, action="edit",
          details={"lines": len(clean), "total_paise": total})


# ---------------------------------------------------------------- submit
def policy_context(conn, claim: dict, lines: list[dict]) -> PolicyContext:
    meal = conn.execute(
        """SELECT l.expense_date, sum(l.amount_paise)::bigint AS total FROM claim_lines l JOIN claims c ON c.id = l.claim_id
           WHERE c.employee_id = %s AND c.id <> %s AND l.category = 'meals' AND c.status <> ALL(%s)
           GROUP BY l.expense_date""", (claim["employee_id"], claim["id"], list(NOT_COUNTED))).fetchall()
    shas = [l["receipt_sha256"] for l in lines if l["receipt_sha256"]]
    hashes = set()
    if shas:
        hashes = {r["sha256"] for r in conn.execute(
            """SELECT DISTINCT r.sha256 FROM claim_lines l JOIN receipts r ON r.id = l.receipt_id JOIN claims c ON c.id = l.claim_id
               WHERE c.id <> %s AND c.status <> ALL(%s) AND r.sha256 = ANY(%s)""",
            (claim["id"], list(NOT_COUNTED), shas)).fetchall()}
    dates = list({l["expense_date"] for l in lines})
    vkeys = set()
    if dates:
        for r in conn.execute(
                """SELECT l.vendor, l.amount_paise, l.expense_date FROM claim_lines l JOIN claims c ON c.id = l.claim_id
                   WHERE c.id <> %s AND c.status <> ALL(%s) AND l.expense_date = ANY(%s)""",
                (claim["id"], list(NOT_COUNTED), dates)).fetchall():
            vkeys.add((norm_vendor(r["vendor"]), r["amount_paise"], r["expense_date"]))
    return PolicyContext(meal_totals_by_date={r["expense_date"]: r["total"] for r in meal},
                         existing_receipt_hashes=hashes, existing_vendor_keys=vkeys)


def submit(conn, user, claim_id: int) -> None:
    claim = load_visible_claim(conn, user, claim_id, for_update=True)
    if claim["employee_id"] != user["id"]:
        raise err(403, "NOT_OWNER", "Only the claimant can submit this claim.")
    if claim["status"] not in EDITABLE:
        raise err(409, "NOT_SUBMITTABLE", f"A claim in status {claim['status']} cannot be submitted.")
    lines = get_lines(conn, claim_id)
    if not lines:
        raise err(422, "NO_LINES", "Add at least one expense line before submitting.")
    # Serialise submits per employee (daily meal totals) and globally per receipt hash/vendor key via one lock.
    conn.execute("SELECT pg_advisory_xact_lock(424242)")
    cfg = load_policy(conn)
    result = evaluate_claim(lines, cfg, policy_context(conn, claim, lines))
    for ln, res in zip(lines, result["lines"]):
        conn.execute("UPDATE claim_lines SET outcome=%s, reasons=%s WHERE id=%s",
                     (res["outcome"], Jsonb(res["reasons"]), ln["id"]))
    flags = sorted({r["code"] for res in result["lines"] for r in res["reasons"]} |
                   {r["code"] for r in result["claim_reasons"]})
    metrics.POLICY_OUTCOMES.labels(outcome=result["outcome"]).inc()
    common = {"total_paise": result["total_paise"], "policy_outcome": result["outcome"], "flags": flags,
              "submitted_at": now_utc(), "sample_audit": False, "auto_approved": False, "required_steps": []}
    details = {"policy_outcome": result["outcome"], "flags": flags, "total_paise": result["total_paise"]}
    if result["outcome"] == "REJECT":
        transition(conn, claim, "AUTO_REJECTED", actor_id=user["id"], action="submit_auto_rejected",
                   extra_sets={**common, "decided_at": now_utc()}, details=details)
    elif result["outcome"] == "APPROVE":
        sampled = is_sampled(claim_id, int(cfg.get("SAMPLE_AUDIT_PERCENT", 10)))
        to = "SAMPLE_AUDIT" if sampled else "APPROVED"
        transition(conn, claim, to, actor_id=user["id"], action="submit_auto_approved",
                   extra_sets={**common, "auto_approved": True, "sample_audit": sampled, "decided_at": now_utc()},
                   details={**details, "sampled_for_audit": sampled})
    else:
        steps = plan_steps(conn, claim, result["total_paise"], cfg)
        transition(conn, claim, "PENDING_APPROVAL", actor_id=user["id"], action="submit_routed",
                   current_step=steps[0], extra_sets={**common, "required_steps": steps},
                   details={**details, "steps": steps})


# ---------------------------------------------------------------- approver actions
def act(conn, user, claim_id: int, action: str, comment: str | None) -> None:
    claim = load_visible_claim(conn, user, claim_id, for_update=True)
    comment = (comment or "").strip() or None
    allowed, on_behalf = acting_identity(conn, user, claim)
    if not allowed:
        if user["id"] == claim["employee_id"]:
            raise err(403, "SELF_APPROVAL", "You cannot approve or reject your own claim.")
        if claim["status"] not in ("PENDING_APPROVAL", "SAMPLE_AUDIT"):
            raise err(409, "NOT_ACTIONABLE", f"A claim in status {claim['status']} has no pending approval.")
        raise err(403, "NOT_CURRENT_APPROVER", "You are not the approver for this step.")
    if action in ("reject", "send_back") and not comment:
        raise err(422, "COMMENT_REQUIRED", "Add a comment so the employee knows what to fix.")
    status = claim["status"]
    kw = dict(actor_id=user["id"], on_behalf_of_id=on_behalf, comment=comment)
    if status == "SAMPLE_AUDIT":
        if action == "clear":
            transition(conn, claim, "APPROVED", action="sample_audit_cleared", **kw)
        elif action == "reject":
            transition(conn, claim, "REJECTED", action="sample_audit_rejected", extra_sets={"decided_at": now_utc()}, **kw)
        else:
            raise err(422, "INVALID_ACTION", "Sample-audit claims can only be cleared or rejected.")
        return
    step = claim["current_step"]
    if action == "approve":
        steps = list(claim["required_steps"] or [step])
        idx = steps.index(step) if step in steps else len(steps) - 1
        nxt = steps[idx + 1] if idx + 1 < len(steps) else None
        if nxt:
            transition(conn, claim, "PENDING_APPROVAL", action=f"approve_{step.lower()}", current_step=nxt, **kw)
        else:
            transition(conn, claim, "APPROVED", action=f"approve_{step.lower()}", extra_sets={"decided_at": now_utc()}, **kw)
    elif action == "reject":
        transition(conn, claim, "REJECTED", action=f"reject_{step.lower()}", extra_sets={"decided_at": now_utc()}, **kw)
    elif action == "send_back":
        transition(conn, claim, "NEEDS_CLARIFICATION", action=f"send_back_{step.lower()}", **kw)
    else:
        raise err(422, "INVALID_ACTION", "Unknown action.")


# ---------------------------------------------------------------- payouts
def bank_ref(user_id: int) -> tuple[str, str]:
    return f"EXF{(user_id * 7919) % 10**9:09d}", f"EXFL0{(user_id * 31) % 10**6:06d}"


def create_batch(conn, user, claim_ids: list[int]) -> int:
    ids = sorted(set(int(i) for i in claim_ids))
    if not ids:
        raise err(422, "NO_CLAIMS", "Select at least one approved claim.")
    claims = conn.execute("SELECT id, status, total_paise, current_step FROM claims WHERE id = ANY(%s) ORDER BY id FOR UPDATE",
                          (ids,)).fetchall()
    found = {c["id"]: c for c in claims}
    bad = [i for i in ids if i not in found or found[i]["status"] != "APPROVED"]
    if bad:
        raise err(409, "NOT_PAYABLE", f"Claims not payable (must be APPROVED and not in a batch): {bad}")
    total = sum(c["total_paise"] for c in claims)
    batch_id = conn.execute("INSERT INTO payout_batches (created_by, total_paise, claim_count) VALUES (%s,%s,%s) RETURNING id",
                            (user["id"], total, len(claims))).fetchone()["id"]
    for n, c in enumerate(claims, 1):
        conn.execute("INSERT INTO payout_items (batch_id, claim_id, line_no, amount_paise) VALUES (%s,%s,%s,%s)",
                     (batch_id, c["id"], n, c["total_paise"]))
        transition(conn, {**c, "status": "APPROVED"}, "IN_PAYOUT", actor_id=user["id"], action="added_to_payout",
                   details={"batch_id": batch_id})
    audit(conn, actor_id=user["id"], entity="payout_batch", entity_id=batch_id, action="create",
          to_status="CREATED", details={"claims": ids, "total_paise": total})
    return batch_id


def mark_paid(conn, user, batch_id: int) -> None:
    row = conn.execute("UPDATE payout_batches SET status='PAID', paid_at=now() WHERE id=%s AND status='CREATED' RETURNING id",
                       (batch_id,)).fetchone()
    if not row:
        exists = conn.execute("SELECT status FROM payout_batches WHERE id=%s", (batch_id,)).fetchone()
        if not exists:
            raise err(404, "NOT_FOUND", "Batch not found.")
        raise err(409, "ALREADY_PAID", "This batch is already marked as paid.")
    for c in conn.execute("""SELECT c.id, c.status, c.current_step FROM claims c JOIN payout_items p ON p.claim_id = c.id
                             WHERE p.batch_id = %s ORDER BY c.id""", (batch_id,)).fetchall():
        transition(conn, c, "PAID", actor_id=user["id"], action="paid", extra_sets={"paid_at": now_utc()},
                   details={"batch_id": batch_id})
    audit(conn, actor_id=user["id"], entity="payout_batch", entity_id=batch_id, action="mark_paid",
          from_status="CREATED", to_status="PAID")


def batch_csv(conn, batch_id: int) -> str:
    rows = conn.execute(
        """SELECT p.line_no, p.claim_id, p.amount_paise, u.id AS emp_id, u.name, u.account_ref, u.ifsc
           FROM payout_items p JOIN claims c ON c.id = p.claim_id JOIN users u ON u.id = c.employee_id
           WHERE p.batch_id = %s ORDER BY p.line_no""", (batch_id,)).fetchall()
    out = ["batch_id,line_no,beneficiary_employee_id,beneficiary_name,account_ref,ifsc,amount_inr,claim_id,narration"]
    for r in rows:
        name = r["name"].replace('"', "'")
        if name[:1] in "=+-@":           # CSV/formula injection guard
            name = "'" + name
        out.append(f'{batch_id},{r["line_no"]},{r["emp_id"]},"{name}",{r["account_ref"]},{r["ifsc"]},'
                   f'{r["amount_paise"] // 100}.{r["amount_paise"] % 100:02d},{r["claim_id"]},EXPENSE CLAIM {r["claim_id"]}')
    return "\r\n".join(out) + "\r\n"
