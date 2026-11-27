"""Policy engine unit tests — written before the engine (one test per rule, plus boundaries)."""
from datetime import date

from app.policy import (APPROVE, REJECT, ROUTE, DEFAULT_CONFIG, PolicyContext, evaluate_claim,
                        is_sampled, required_steps)

FRI = date(2026, 11, 20)
SAT = date(2026, 11, 21)
SUN = date(2026, 11, 22)
MON = date(2026, 11, 23)


def line(category="local_cab", amount=10000, d=FRI, vendor="Uber", receipt=None, sha=None, city=None, nights=None):
    return {"category": category, "amount_paise": amount, "expense_date": d, "vendor": vendor,
            "receipt_id": receipt, "receipt_sha256": sha, "city": city, "nights": nights}


def ev(lines, ctx=None):
    return evaluate_claim(lines, DEFAULT_CONFIG, ctx or PolicyContext())


def codes(result, i=0):
    return {r["code"] for r in result["lines"][i]["reasons"]}


# ---- meals: 1,500 per employee per day ----
def test_meal_at_limit_is_approved():
    assert ev([line("meals", 150000, receipt=1, sha="a")])["outcome"] == APPROVE


def test_meal_one_paisa_over_limit_routes():
    r = ev([line("meals", 150001, receipt=1, sha="a")])
    assert r["outcome"] == ROUTE and "MEAL_DAILY_LIMIT" in codes(r)


def test_meal_limit_sums_lines_in_same_claim_same_day():
    r = ev([line("meals", 100000, receipt=1, sha="a", vendor="A"), line("meals", 60000, receipt=2, sha="b", vendor="B")])
    assert r["outcome"] == ROUTE


def test_meal_limit_counts_other_claims_same_day():
    ctx = PolicyContext(meal_totals_by_date={FRI: 100000})
    r = ev([line("meals", 60000, receipt=1, sha="a")], ctx)
    assert "MEAL_DAILY_LIMIT" in codes(r)


def test_meals_on_different_days_not_summed():
    r = ev([line("meals", 140000, d=FRI, receipt=1, sha="a"), line("meals", 140000, d=MON, receipt=2, sha="b")])
    assert r["outcome"] == APPROVE


# ---- hotel: 6,000 tier-1 / 4,000 other, per night ----
def test_hotel_tier1_at_limit_approved():
    assert ev([line("hotel", 1200000, city="Mumbai", nights=2, receipt=1, sha="a", vendor="Taj")])["outcome"] == APPROVE


def test_hotel_tier1_over_limit_routes():
    r = ev([line("hotel", 1200001, city="Mumbai", nights=2, receipt=1, sha="a", vendor="Taj")])
    assert "HOTEL_NIGHT_LIMIT_TIER1" in codes(r)


def test_hotel_other_city_uses_lower_limit():
    r = ev([line("hotel", 450000, city="Indore", nights=1, receipt=1, sha="a", vendor="Inn")])
    assert "HOTEL_NIGHT_LIMIT_OTHER" in codes(r)
    assert ev([line("hotel", 400000, city="Indore", nights=1, receipt=1, sha="a", vendor="Inn")])["outcome"] == APPROVE


def test_tier1_city_match_is_case_insensitive():
    assert ev([line("hotel", 550000, city=" bengaluru ", nights=1, receipt=1, sha="a", vendor="X")])["outcome"] == APPROVE


# ---- local cab: 2,000 per trip ----
def test_cab_at_limit_approved_and_over_routes():
    assert ev([line("local_cab", 200000, receipt=1, sha="a")])["outcome"] == APPROVE
    assert "CAB_TRIP_LIMIT" in codes(ev([line("local_cab", 200001, receipt=1, sha="a")]))


# ---- receipt mandatory above 500 ----
def test_no_receipt_at_500_ok():
    assert ev([line("local_cab", 50000)])["outcome"] == APPROVE


def test_no_receipt_above_500_rejects():
    r = ev([line("local_cab", 50001)])
    assert r["outcome"] == REJECT and "RECEIPT_REQUIRED_ABOVE" in codes(r)


# ---- duplicates ----
def test_same_receipt_hash_on_earlier_claim_rejects():
    r = ev([line(receipt=5, sha="dead")], PolicyContext(existing_receipt_hashes={"dead"}))
    assert r["outcome"] == REJECT and "DUPLICATE_RECEIPT_HASH" in codes(r)


def test_same_receipt_hash_twice_in_one_claim_rejects_second():
    r = ev([line(receipt=5, sha="dead", vendor="A"), line(receipt=6, sha="dead", vendor="B", amount=20000)])
    assert "DUPLICATE_RECEIPT_HASH" not in codes(r, 0) and "DUPLICATE_RECEIPT_HASH" in codes(r, 1)


def test_vendor_amount_date_duplicate_routes():
    ctx = PolicyContext(existing_vendor_keys={("uber", 10000, FRI)})
    r = ev([line(vendor="  UBER ")], ctx)
    assert r["outcome"] == ROUTE and "DUPLICATE_VENDOR_AMOUNT_DATE" in codes(r)


def test_vendor_duplicate_inside_same_claim_routes():
    r = ev([line(), line()])
    assert "DUPLICATE_VENDOR_AMOUNT_DATE" in codes(r, 1)


def test_different_amount_is_not_duplicate():
    ctx = PolicyContext(existing_vendor_keys={("uber", 10000, FRI)})
    assert ev([line(amount=10001)], ctx)["outcome"] == APPROVE


# ---- weekend ----
def test_saturday_and_sunday_flagged_friday_not():
    assert "WEEKEND_SPEND" in codes(ev([line(d=SAT)]))
    assert "WEEKEND_SPEND" in codes(ev([line(d=SUN)]))
    assert ev([line(d=FRI)])["outcome"] == APPROVE


# ---- claim-level outcome ----
def test_worst_line_wins_reject_over_route():
    r = ev([line(d=SAT), line("local_cab", 60000, vendor="Ola")])
    assert r["outcome"] == REJECT


def test_clean_claim_above_auto_approve_cap_routes():
    lines = [line("airfare", 2500001, receipt=1, sha="a", vendor="IndiGo")]
    r = ev(lines)
    assert r["outcome"] == ROUTE and r["total_paise"] == 2500001
    assert ev([line("airfare", 2500000, receipt=1, sha="a", vendor="IndiGo")])["outcome"] == APPROVE


def test_config_change_changes_outcome_without_code_change():
    cfg = dict(DEFAULT_CONFIG, CAB_TRIP_LIMIT=300000)
    assert evaluate_claim([line("local_cab", 250000, receipt=1, sha="a")], cfg, PolicyContext())["outcome"] == APPROVE


# ---- thresholds & sampling ----
def test_required_steps_thresholds_strictly_greater():
    assert required_steps(2500000, DEFAULT_CONFIG) == ["MANAGER"]
    assert required_steps(2500001, DEFAULT_CONFIG) == ["MANAGER", "AUDITOR"]
    assert required_steps(10000000, DEFAULT_CONFIG) == ["MANAGER", "AUDITOR"]
    assert required_steps(10000001, DEFAULT_CONFIG) == ["MANAGER", "AUDITOR", "HEAD"]


def test_sampling_is_about_ten_percent_and_deterministic():
    hits = sum(is_sampled(i, 10) for i in range(1, 5001))
    assert 400 <= hits <= 600
    assert is_sampled(42, 10) == is_sampled(42, 10)
    assert not any(is_sampled(i, 0) for i in range(100))
