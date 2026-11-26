"""Shared helpers: errors, clock, IDs, input validation."""
import math
import re
import secrets
from datetime import datetime, timezone

from flask import request

SELLER_ROLES = {"farmer", "collector", "coop_admin"}
BUYER_ROLES = {"buyer", "collector", "coop_admin"}
REGISTERABLE_ROLES = {"farmer", "buyer", "driver", "collector", "coop_admin"}


class ApiError(Exception):
    """Raised anywhere in a request; the app turns it into a JSON error response."""

    def __init__(self, message, status=400, code=None):
        super().__init__(message)
        self.message, self.status, self.code = message, status, code


_clock = None  # tests can replace the clock to simulate the 60-second booking hold


def set_clock(fn):
    global _clock
    _clock = fn


def now():
    return _clock() if _clock else datetime.now(timezone.utc)


def iso(dt=None):
    return (dt or now()).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(value):
    """Parse an ISO date or datetime. Naive values are treated as UTC."""
    try:
        dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        raise ApiError(f"'{value}' is not a valid date/time", 422)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def new_public_id(prefix):
    return f"{prefix}-{secrets.token_hex(4).upper()}"


def json_body():
    data = request.get_json(silent=True)
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise ApiError("Request body must be a JSON object", 400)
    return data


def field(data, name, kind="str", required=True, default=None, min=None, max=None,
          maxlen=500, choices=None):
    """Read and validate one field. kind: str | int | float | bool | datetime."""
    v = data.get(name)
    if v is None or (isinstance(v, str) and v.strip() == ""):
        if required:
            raise ApiError(f"'{name}' is required", 422)
        return default
    if kind == "str":
        if not isinstance(v, (str, int, float)) or isinstance(v, bool):
            raise ApiError(f"'{name}' must be text", 422)
        v = str(v).strip()
        if len(v) > maxlen:
            raise ApiError(f"'{name}' is too long (max {maxlen} characters)", 422)
    elif kind in ("int", "float"):
        if isinstance(v, bool):
            raise ApiError(f"'{name}' must be a number", 422)
        try:
            f = float(v)
        except (TypeError, ValueError):
            raise ApiError(f"'{name}' must be a number", 422)
        if not math.isfinite(f):
            raise ApiError(f"'{name}' must be a finite number", 422)
        if kind == "int":
            if not f.is_integer():
                raise ApiError(f"'{name}' must be a whole number", 422)
            v = int(f)
        else:
            v = f
        if min is not None and v < min:
            raise ApiError(f"'{name}' must be at least {min}", 422)
        if max is not None and v > max:
            raise ApiError(f"'{name}' must be at most {max}", 422)
    elif kind == "bool":
        if isinstance(v, bool):
            pass
        elif str(v).lower() in ("true", "1", "yes", "on"):
            v = True
        elif str(v).lower() in ("false", "0", "no", "off"):
            v = False
        else:
            raise ApiError(f"'{name}' must be true or false", 422)
    elif kind == "datetime":
        v = iso(parse_iso(v))
    if choices is not None and v not in choices:
        raise ApiError(f"'{name}' must be one of: {', '.join(map(str, choices))}", 422)
    return v


PHONE_RE = re.compile(r"^\+2507\d{8}$")


def normalise_phone(raw):
    """Accept 07XXXXXXXX, 2507XXXXXXXX or +2507XXXXXXXX; return +2507XXXXXXXX."""
    p = re.sub(r"[\s\-()]", "", str(raw or ""))
    if p.startswith("07"):
        p = "+250" + p[1:]
    elif p.startswith("2507"):
        p = "+" + p
    if not PHONE_RE.match(p):
        raise ApiError("Enter a valid Rwandan mobile number, e.g. 0788123456", 422)
    return p


def check_password_strength(pw):
    if not isinstance(pw, str) or len(pw) < 8 or not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        raise ApiError("Password must be at least 8 characters and include a letter and a number", 422)
