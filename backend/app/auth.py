"""Session auth, password hashing and role guards."""
import hashlib
import hmac
import os
import secrets

from fastapi import Depends, HTTPException, Request

from .db import get_conn

ITERATIONS = 20000


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(8)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), ITERATIONS)
    return f"pbkdf2${salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt, digest = stored.split("$")
    except ValueError:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), ITERATIONS)
    return hmac.compare_digest(dk.hex(), digest)


def err(status: int, code: str, detail: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"detail": detail, "code": code})


USER_SQL = """SELECT u.id, u.name, u.email, u.role, u.department_id, d.name AS department, u.manager_id,
                     EXISTS (SELECT 1 FROM users r WHERE r.manager_id = u.id) AS is_manager
              FROM users u JOIN departments d ON d.id = u.department_id WHERE u.id = %s"""


def current_user(request: Request, conn=Depends(get_conn)) -> dict:
    uid = request.session.get("uid")
    if not uid:
        raise err(401, "NOT_AUTHENTICATED", "Please sign in.")
    user = conn.execute(USER_SQL, (uid,)).fetchone()
    if not user:
        request.session.clear()
        raise err(401, "NOT_AUTHENTICATED", "Please sign in.")
    return user


def require_roles(*roles):
    def dep(user=Depends(current_user)):
        if user["role"] not in roles:
            raise err(403, "FORBIDDEN_ROLE", "You don't have permission for this action.")
        return user
    return dep


SESSION_SECRET = os.getenv("SESSION_SECRET", "dev-only-change-me")
