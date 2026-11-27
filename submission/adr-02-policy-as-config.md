# ADR-02: Policy rules as configuration evaluated by a pure engine

**Status:** Accepted
**Date:** 27 Nov 2026
**Deciders:** Team 01 (ExpenseFlow)
**Related:** CLAUDE.md "Policy engine"; ideation scope item 8, D1, D2, D3, D5, D6, D7, D11; [low-level design §7](low-level-design.md)

## Context

The brief requires policy rules to be **seeded as configuration, not hard-coded**, and asks for the policy engine to be built **test-first**. Each expense line must end as auto-approve, route for approval, or auto-reject, with a human-readable reason. Rules include amount limits (meal per day across claims, hotel per night by city tier, cab per trip), a receipt requirement, two kinds of duplicate detection, weekend spend, an auto-approve ceiling and a sample-audit percentage.

Finance wants to change a limit (e.g. raise the meal limit) without a deploy. Judges want to see every rule tested at its boundary.

## Options considered

### (1) Hard-coded rules in Python
- Pro: Fastest to write; fully type-checked.
- Con: Violates the brief (rules must be configuration).
- Con: Every limit change is a code change and deploy.

### (2) `policy_rules` table (code → value, outcome) read by a pure Python evaluator (chosen)
The rule **logic** is a fixed, named set of Python functions (one per rule code). The rule **parameters** (limits, thresholds, percentages, the tier-1 city list) and outcomes are rows in `policy_rules`.

- Pro: Meets the brief: values live in the DB, seeded, visible at `GET /api/policy`, editable by the head (`PUT /api/policy/{code}`, audited).
- Pro: The evaluator is a pure function `evaluate(lines, context, rules)`: no DB, no clock, no randomness. Unit tests need no database and run in milliseconds; boundary tests (₹1,500 vs ₹1,500.01, etc.) are trivial.
- Pro: Each rule produces a stable code and message, so reasons in the UI, `violations_by_rule` on the dashboard and the `expenseflow_policy_outcomes_total` metric all share one vocabulary.
- Con: Adding a **new kind** of rule still needs code. Changing a **value** does not.

### (3) Rules DSL / external engine (JSON-logic, OPA/Rego, Drools)
- Pro: New rule shapes without code; OPA gives strong policy tooling.
- Con: Cross-claim aggregates (meal total per employee per day, hash seen on another claim) need data the engine cannot fetch itself; we would still prepare context in Python, so the DSL buys little.
- Con: Another language for the team and judges to read; harder to explain a rejection reason; OPA adds a sidecar service.
- Con: A config-editable DSL lets an admin write a rule that silently approves everything — a bigger audit risk than editing a number.

## Decision

Choose **(2)**: a `policy_rules` table plus a pure evaluator in `backend/app/policy.py`.

- `workflow.submit` loads all rules into a dict and gathers the cross-claim context (same-day meal totals, known receipt hashes, prior vendor/amount/date tuples, today's IST date), then calls `policy.evaluate_claim`.
- Line outcome = worst of its rule results (REJECT > ROUTE > APPROVE). Claim outcome = worst line outcome; APPROVE with `total > AUTO_APPROVE_MAX_TOTAL` becomes ROUTE.
- All comparisons are integer paise and **strictly greater than** the limit.
- At runtime every limit comes from the `policy_rules` table (`db.load_policy`). `policy.py` also holds `DEFAULT_CONFIG`, a copy of the seeded values used by the unit tests and as a fallback: `evaluate_claim` merges `{**DEFAULT_CONFIG, **config}` (`policy.py:69`), so a rule code missing from the table falls back to its seeded default instead of raising. The seed writes every rule from `DEFAULT_CONFIG`, so the table and the defaults start identical. `test_config_change_changes_outcome_without_code_change` (unit) and `test_policy_change_by_head_takes_effect_without_code_change` (API) prove a config change alters the outcome with no code change.
- Unknown rule codes cannot be written: `PUT /api/policy/{code}` returns 404 for a code not in the table and 422 for a value of the wrong type.

## Consequences

- **Positive:** tests first was practical (unit tests written before the engine); every rule has a boundary test; finance can change limits with an audited API call; the dashboard and metrics count violations by rule code.
- **Positive:** the engine is deterministic, so re-running policy on resubmit gives explainable, reproducible results, and sample-audit selection (`sha256(claim_id:salt) % 100 < percent`) cannot be re-rolled.
- **Negative:** new rule types need a developer. Acceptable for the hackathon and arguably desirable for control.
- **Negative:** policy changes apply to claims submitted after the change only; already-decided claims keep their stored reasons. Policy edits are made in the built **Policy** page for the finance head (`frontend/src/pages/Policy.jsx`, screenshot `screenshots/11-policy-config.png`), which calls `PUT /api/policy/{code}`; every edit is audited with old and new value. Versioned policy history (effective-dated rules) remains backlog.
