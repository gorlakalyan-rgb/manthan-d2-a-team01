"""Prometheus metrics. Queue gauges are refreshed from the DB on every scrape."""
from prometheus_client import CollectorRegistry, Counter, Gauge, Histogram, generate_latest

REGISTRY = CollectorRegistry()

REQUEST_LATENCY = Histogram("expenseflow_http_request_duration_seconds", "HTTP request latency",
                            ["method", "route", "status"], registry=REGISTRY,
                            buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5))
QUEUE_SIZE = Gauge("expenseflow_approval_queue_size", "Claims waiting for approval", ["step"], registry=REGISTRY)
OLDEST_PENDING = Gauge("expenseflow_oldest_pending_approval_hours", "Age of the oldest pending approval (hours)",
                       registry=REGISTRY)
CLAIM_TRANSITIONS = Counter("expenseflow_claim_transitions_total", "Claim state transitions", ["to_status"],
                            registry=REGISTRY)
POLICY_OUTCOMES = Counter("expenseflow_policy_outcomes_total", "Policy engine outcomes at submit", ["outcome"],
                          registry=REGISTRY)


def refresh_queue_gauges(conn) -> None:
    rows = conn.execute("""SELECT coalesce(current_step, 'SAMPLE_AUDIT') AS step, count(*) AS n
                           FROM claims WHERE status IN ('PENDING_APPROVAL','SAMPLE_AUDIT') GROUP BY 1""").fetchall()
    counts = {r["step"]: r["n"] for r in rows}
    for step in ("MANAGER", "AUDITOR", "HEAD", "SAMPLE_AUDIT"):
        QUEUE_SIZE.labels(step=step).set(counts.get(step, 0))
    oldest = conn.execute("""SELECT coalesce(extract(epoch FROM now() - min(step_entered_at)) / 3600, 0) AS h
                             FROM claims WHERE status = 'PENDING_APPROVAL'""").fetchone()["h"]
    OLDEST_PENDING.set(float(oldest))


def render(conn) -> bytes:
    refresh_queue_gauges(conn)
    return generate_latest(REGISTRY)
