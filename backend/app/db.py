"""Database helpers: one connection per request, explicit transactions, parameterised SQL only."""
import json
import os
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://expenseflow:expenseflow@localhost:5432/expenseflow")
SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def connect(url: str | None = None) -> psycopg.Connection:
    return psycopg.connect(url or DATABASE_URL, row_factory=dict_row)


def get_conn():
    """FastAPI dependency: commit on success, rollback on error."""
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def apply_schema(conn) -> None:
    conn.execute(SCHEMA_PATH.read_text(encoding="utf-8"))


def reset_schema(conn) -> None:
    conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    apply_schema(conn)


def load_policy(conn) -> dict:
    rows = conn.execute("SELECT code, value FROM policy_rules").fetchall()
    return {r["code"]: r["value"] for r in rows}


def audit(conn, *, actor_id, entity, entity_id, action, from_status=None, to_status=None,
          comment=None, details=None, on_behalf_of_id=None) -> None:
    conn.execute(
        """INSERT INTO audit_log (actor_id, on_behalf_of_id, entity, entity_id, action, from_status, to_status, comment, details)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (actor_id, on_behalf_of_id, entity, entity_id, action, from_status, to_status, comment, Jsonb(details or {})),
    )


__all__ = ["connect", "get_conn", "apply_schema", "reset_schema", "load_policy", "audit", "Jsonb", "json"]
