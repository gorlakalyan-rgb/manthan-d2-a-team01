"""ExpenseFlow load test (Locust). Read-heavy mix of the screens people use most.

Each simulated user logs in once as one of the synthetic demo personas, then loops over:
  - GET /api/claims          (employee: My claims)
  - GET /api/dashboard       (finance head / auditor: dashboard)
  - GET /api/audit/queue     (finance head / auditor: review queue, two filter shapes)
It does not submit or approve claims, so a run leaves the seeded data unchanged
(apart from `login` rows in the append-only audit log).

Run headless against the local stack (docker compose up -d --build --wait):
    pip install locust
    locust -f ops/locustfile.py --host http://localhost:8080 --headless \
           -u 20 -r 5 -t 20s --csv submission/locust --only-summary
    mv submission/locust_stats.csv submission/locust-stats.csv   # other CSVs are not kept
Synthetic data only; demo password from the seed (CLAUDE.md).
"""
import random

from locust import HttpUser, between, task

H = {"X-Requested-With": "ExpenseFlow"}          # CSRF header required on every non-GET /api call
PASSWORD = "demo123"                               # seeded demo password (synthetic data only)
EMPLOYEES = ["employee@demo.expenseflow.test", "employee2@demo.expenseflow.test"]
FINANCE = ["head@demo.expenseflow.test", "auditor@demo.expenseflow.test"]


def login(client, email):
    with client.post("/api/auth/login", json={"email": email, "password": PASSWORD}, headers=H,
                     name="POST /api/auth/login", catch_response=True) as r:
        if r.status_code != 200:
            r.failure(f"login {email} -> {r.status_code}")


class Employee(HttpUser):
    """Employee checking their claims list."""
    weight = 1
    wait_time = between(0.5, 1.5)

    def on_start(self):
        login(self.client, random.choice(EMPLOYEES))

    @task
    def my_claims(self):
        self.client.get("/api/claims", name="GET /api/claims")


class Finance(HttpUser):
    """Finance head or auditor working the dashboard and review queue."""
    weight = 1
    wait_time = between(0.5, 1.5)

    def on_start(self):
        login(self.client, random.choice(FINANCE))

    @task(2)
    def dashboard(self):
        self.client.get("/api/dashboard", name="GET /api/dashboard")

    @task(2)
    def audit_queue(self):
        self.client.get("/api/audit/queue", params={"kind": "all"}, name="GET /api/audit/queue?kind=all")

    @task(1)
    def oversight_queue(self):
        self.client.get("/api/audit/queue", params={"kind": "all_pending"}, name="GET /api/audit/queue?kind=all_pending")

    @task(1)
    def claims(self):
        self.client.get("/api/claims", name="GET /api/claims")
