"""Authentication, role checks, CSRF guard and login throttling."""
import time
from functools import wraps

from flask import g, request, session
from werkzeug.security import check_password_hash, generate_password_hash

from .common import ApiError
from .database import get_db

_failures = {}  # (phone, ip) -> [timestamps]


def hash_password(password):
    return generate_password_hash(password)  # salted scrypt (Werkzeug default)


def verify_password(password_hash, password):
    return check_password_hash(password_hash, password)


def throttle_check(cfg, key):
    window = cfg["LOGIN_WINDOW_SECONDS"]
    recent = [t for t in _failures.get(key, []) if time.time() - t < window]
    _failures[key] = recent
    if len(recent) >= cfg["LOGIN_MAX_FAILURES"]:
        raise ApiError("Too many failed attempts. Please wait a few minutes and try again.", 429)


def throttle_fail(key):
    _failures.setdefault(key, []).append(time.time())


def throttle_clear(key):
    _failures.pop(key, None)


def reset_throttle():
    _failures.clear()


def check_csrf():
    """State-changing API calls must carry a custom header. Browsers will not add it to
    cross-site form posts, which blocks classic CSRF (together with SameSite=Lax cookies)."""
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        if request.headers.get("X-Requested-With") != "AmataShield":
            raise ApiError("Missing X-Requested-With header", 403)


def load_user():
    uid = session.get("uid")
    g.user = None
    if uid:
        row = get_db().execute("SELECT * FROM users WHERE id=? AND is_active=1", (uid,)).fetchone()
        if row:
            g.user = row
        else:
            session.clear()


def login_required(*roles):
    def deco(fn):
        @wraps(fn)
        def wrapper(*a, **kw):
            if g.get("user") is None:
                raise ApiError("Please log in", 401)
            if roles and g.user["role"] not in roles:
                raise ApiError("Your account role is not allowed to do this", 403)
            return fn(*a, **kw)
        return wrapper
    return deco
