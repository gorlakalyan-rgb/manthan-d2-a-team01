"""Pure policy engine. No DB, no clock: everything comes in through config + context.

Rules are configuration (policy_rules table); DEFAULT_CONFIG mirrors the seeded rows and is used by tests.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import date

APPROVE, ROUTE, REJECT = "APPROVE", "ROUTE", "REJECT"
_RANK = {APPROVE: 0, ROUTE: 1, REJECT: 2}

CATEGORIES = ["meals", "hotel", "local_cab", "airfare", "train", "office_supplies", "internet", "other"]
SAMPLE_SALT = "expenseflow-sample-v1"

DEFAULT_CONFIG: dict = {
    "MEAL_DAILY_LIMIT": 150000,
    "HOTEL_NIGHT_LIMIT_TIER1": 600000,
    "HOTEL_NIGHT_LIMIT_OTHER": 400000,
    "CAB_TRIP_LIMIT": 200000,
    "RECEIPT_REQUIRED_ABOVE": 50000,
    "DUPLICATE_RECEIPT_HASH": 1,
    "DUPLICATE_VENDOR_AMOUNT_DATE": 1,
    "WEEKEND_SPEND": 1,
    "AUTO_APPROVE_MAX_TOTAL": 2500000,
    "AUDITOR_THRESHOLD": 2500000,
    "HEAD_THRESHOLD": 10000000,
    "SAMPLE_AUDIT_PERCENT": 10,
    "TIER1_CITIES": ["Mumbai", "Delhi", "Bengaluru", "Chennai", "Kolkata", "Hyderabad", "Pune"],
}

RULE_OUTCOME = {
    "MEAL_DAILY_LIMIT": ROUTE,
    "HOTEL_NIGHT_LIMIT_TIER1": ROUTE,
    "HOTEL_NIGHT_LIMIT_OTHER": ROUTE,
    "CAB_TRIP_LIMIT": ROUTE,
    "RECEIPT_REQUIRED_ABOVE": REJECT,
    "DUPLICATE_RECEIPT_HASH": REJECT,
    "DUPLICATE_VENDOR_AMOUNT_DATE": ROUTE,
    "WEEKEND_SPEND": ROUTE,
    "AUTO_APPROVE_MAX_TOTAL": ROUTE,
}


@dataclass
class PolicyContext:
    """Facts from outside this claim (other non-rejected claims)."""
    meal_totals_by_date: dict = field(default_factory=dict)        # {date: paise} for this employee, other claims
    existing_receipt_hashes: set = field(default_factory=set)       # sha256 used on other claims' lines
    existing_vendor_keys: set = field(default_factory=set)          # {(vendor_norm, amount_paise, date)}


def rupees(paise: int) -> str:
    r = paise / 100
    return f"₹{r:,.2f}".replace(".00", "")


def norm_vendor(v: str | None) -> str:
    return " ".join((v or "").lower().split())


def _reason(code: str, message: str) -> dict:
    return {"code": code, "message": message, "outcome": RULE_OUTCOME[code]}


def evaluate_claim(lines: list[dict], config: dict, ctx: PolicyContext) -> dict:
    """Return {outcome, total_paise, lines:[{outcome, reasons}]} — lines in input order."""
    cfg = {**DEFAULT_CONFIG, **(config or {})}
    tier1 = {c.strip().lower() for c in cfg["TIER1_CITIES"]}
    meal_running = dict(ctx.meal_totals_by_date)
    seen_hashes = set(ctx.existing_receipt_hashes)
    seen_vendor = set(ctx.existing_vendor_keys)
    results = []
    total = 0

    for ln in lines:
        amt = int(ln["amount_paise"])
        d: date = ln["expense_date"]
        cat = ln["category"]
        total += amt
        reasons: list[dict] = []

        if cat == "meals":
            before = meal_running.get(d, 0)
            meal_running[d] = before + amt
            if meal_running[d] > cfg["MEAL_DAILY_LIMIT"]:
                reasons.append(_reason("MEAL_DAILY_LIMIT",
                    f"Meals on {d.isoformat()} total {rupees(meal_running[d])}, above the {rupees(cfg['MEAL_DAILY_LIMIT'])} daily limit."))
        elif cat == "hotel":
            nights = max(int(ln.get("nights") or 1), 1)
            is_t1 = (ln.get("city") or "").strip().lower() in tier1
            code = "HOTEL_NIGHT_LIMIT_TIER1" if is_t1 else "HOTEL_NIGHT_LIMIT_OTHER"
            limit = cfg[code] * nights
            if amt > limit:
                reasons.append(_reason(code,
                    f"Hotel {rupees(amt)} for {nights} night(s) is above the {rupees(cfg[code])}/night limit for "
                    f"{'tier-1' if is_t1 else 'non tier-1'} cities ({rupees(limit)})."))
        elif cat == "local_cab":
            if amt > cfg["CAB_TRIP_LIMIT"]:
                reasons.append(_reason("CAB_TRIP_LIMIT",
                    f"Cab trip {rupees(amt)} is above the {rupees(cfg['CAB_TRIP_LIMIT'])} per-trip limit."))

        if amt > cfg["RECEIPT_REQUIRED_ABOVE"] and not ln.get("receipt_id"):
            reasons.append(_reason("RECEIPT_REQUIRED_ABOVE",
                f"Receipt needed: lines above {rupees(cfg['RECEIPT_REQUIRED_ABOVE'])} must have a receipt."))

        sha = ln.get("receipt_sha256")
        if cfg.get("DUPLICATE_RECEIPT_HASH") and sha:
            if sha in seen_hashes:
                reasons.append(_reason("DUPLICATE_RECEIPT_HASH",
                    "This receipt file has already been used on another expense line."))
            seen_hashes.add(sha)

        vkey = (norm_vendor(ln.get("vendor")), amt, d)
        if cfg.get("DUPLICATE_VENDOR_AMOUNT_DATE"):
            if vkey in seen_vendor:
                reasons.append(_reason("DUPLICATE_VENDOR_AMOUNT_DATE",
                    f"Possible duplicate: same vendor, amount and date as an earlier line ({ln.get('vendor')}, {rupees(amt)}, {d.isoformat()})."))
            seen_vendor.add(vkey)

        if cfg.get("WEEKEND_SPEND") and d.weekday() >= 5:
            reasons.append(_reason("WEEKEND_SPEND", f"Weekend spend on {d.strftime('%A')} — flagged for manager attention."))

        outcome = max((r["outcome"] for r in reasons), key=_RANK.get, default=APPROVE)
        results.append({"outcome": outcome, "reasons": reasons})

    claim_outcome = max((r["outcome"] for r in results), key=_RANK.get, default=APPROVE)
    claim_reasons = []
    if claim_outcome == APPROVE and total > cfg["AUTO_APPROVE_MAX_TOTAL"]:
        claim_outcome = ROUTE
        claim_reasons.append(_reason("AUTO_APPROVE_MAX_TOTAL",
            f"Claim total {rupees(total)} is above the {rupees(cfg['AUTO_APPROVE_MAX_TOTAL'])} auto-approval cap."))
    return {"outcome": claim_outcome, "total_paise": total, "lines": results, "claim_reasons": claim_reasons}


def required_steps(total_paise: int, config: dict) -> list[str]:
    cfg = {**DEFAULT_CONFIG, **(config or {})}
    steps = ["MANAGER"]
    if total_paise > cfg["AUDITOR_THRESHOLD"]:
        steps.append("AUDITOR")
    if total_paise > cfg["HEAD_THRESHOLD"]:
        steps.append("HEAD")
    return steps


def is_sampled(claim_id: int, percent: int) -> bool:
    h = int(hashlib.sha256(f"{claim_id}:{SAMPLE_SALT}".encode()).hexdigest(), 16)
    return h % 100 < int(percent)
