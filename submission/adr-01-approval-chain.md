# ADR-01: How approval chains are modelled

**Status:** Accepted
**Date:** 27 Nov 2026
**Deciders:** Team 01 (ExpenseFlow)
**Related:** CLAUDE.md "Claim state machine", "Approval steps", "Who approves a step"; ideation D3, D4, D8, D9, D10; [low-level design §8](low-level-design.md)

## Context

A routed claim must pass manager → finance auditor (claim total > ₹25,000) → finance head (total > ₹1,00,000). The chain also has to handle:

- **Send back** for clarification, after which the chain restarts from the manager (D8).
- **Delegation** while on leave, with a date window, recorded as "X on behalf of Y" (D9).
- **No self-approval**, including through a delegate, and skipping the manager step when the claimant has no manager (D10).
- **Concurrency**: two people may click approve at once; only one may win.
- Thresholds that are **configuration** (`AUDITOR_THRESHOLD`, `HEAD_THRESHOLD` in `policy_rules`), not code.

We have one day, three to four developers, and judges who will try to break approvals. The model has to be small enough to test fully and obviously correct when read.

## Options considered

### (a) Static per-claim chain computed at submit, stored as rows
A `claim_approvals(claim_id, seq, step, approver_id, status)` table filled at submit.

- Pro: The full planned chain is visible as data; easy "who's next" display.
- Con: Approver is frozen at submit. Delegation, a manager change, or an auditor going on leave means rewriting rows, and stale rows become a bypass surface.
- Con: Two sources of truth (claim status and approval rows) that must stay in sync under concurrency; send-back must delete or void rows.
- Con: More tables, more joins, more tests.

### (b) `current_step` on the claim + approver resolved at action time from config thresholds (chosen)
`claims.status` + `claims.current_step ∈ {MANAGER, AUDITOR, HEAD, NULL}`. The planned steps come from the claim total and thresholds; who may act is computed by one function, `can_act(user, claim)`, using `manager_id`, roles and active delegations.

- Pro: One row is the whole state. Every transition is one conditional `UPDATE ... WHERE status=%s AND current_step IS NOT DISTINCT FROM %s`, which gives concurrency safety for free.
- Pro: Delegation and leave work immediately, because resolution happens when the person acts.
- Pro: Send-back is just `current_step = NULL`; resubmit re-plans.
- Pro: The same `can_act` drives the inbox, `allowed_actions` and the action endpoint, so UI and server cannot disagree.
- Con: The future chain is not stored; the UI derives "next: Auditor, then Head" from the total.
- Con: AUDITOR and HEAD steps are pools (any auditor / any head), not named people. This is what the brief describes.

### (c) Generic workflow engine / BPMN (e.g. Camunda, Temporal, a homegrown engine)
- Pro: Flexible for future processes; graphical models.
- Con: A new service to run, learn and secure in one day; the security checks (self-approval, delegation) still have to be written by us inside it.
- Con: The state lives outside PostgreSQL, so audit and concurrency guarantees span two systems.
- Con: Overkill for a three-step linear chain.

## Decision

Choose **(b)**. A claim carries `status` and `current_step`. On submit, `workflow.py` plans steps:

1. MANAGER, unless `manager_id` is null or the claimant; then AUDITOR becomes mandatory.
2. AUDITOR if `total_paise > AUDITOR_THRESHOLD`.
3. HEAD if `total_paise > HEAD_THRESHOLD`, skipped (and logged `head_step_skipped_self`) if the claimant is the only head.

`current_step` is set to the first step. Each approve moves to the next planned step or to `APPROVED`. `can_act` checks the user is the step's approver or an active delegate of that approver, and is never the claimant. Every transition is a conditional UPDATE plus an audit row in one transaction.

## Consequences

- **Positive:** small, readable state machine (one table of transitions in `workflow.py` mirrors CLAUDE.md); race-free approvals; delegation and leave need no data repair; every bypass in the LLD bypass table maps to one check in `can_act` or the conditional UPDATE.
- **Negative:** the planned chain is recomputed, not stored, so if a head changes `AUDITOR_THRESHOLD` while a claim is mid-chain, the remaining steps follow the new value. We accept this; policy edits are audited and rare. The timeline (audit log) still shows exactly who approved what.
- **Negative:** no parallel approvals or per-department custom chains. Not needed for the brief; would need option (a) or (c) later.
- **Follow-ups:** tests for every row in the state table, for delegation windows (first and last day inclusive), for self-approval through delegation, and a concurrency test with two simultaneous approves.
