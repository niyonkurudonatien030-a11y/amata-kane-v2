"""System administrator tools."""
from flask import Blueprint, g, jsonify, request

from .. import audit
from ..common import ApiError, iso
from ..database import get_db
from ..security import login_required

bp = Blueprint("admin", __name__, url_prefix="/api/admin")


@bp.get("/users")
@login_required("admin")
def users():
    q = request.args.get("q", "").strip()
    sql, args = "SELECT public_id, full_name, phone, role, district, is_verified, is_active, created_at FROM users", []
    if q:
        sql += " WHERE full_name LIKE ? OR phone LIKE ?"
        args += [f"%{q}%", f"%{q}%"]
    return jsonify([dict(r) for r in get_db().execute(sql + " ORDER BY id DESC LIMIT 200", args)])


def _set(pid, col, value, action):
    db = get_db()
    u = db.execute("SELECT id, role FROM users WHERE public_id=?", (pid,)).fetchone()
    if not u:
        raise ApiError("User not found", 404)
    if u["id"] == g.user["id"] and col == "is_active":
        raise ApiError("You cannot deactivate your own account", 409)
    db.execute(f"UPDATE users SET {col}=?, updated_at=? WHERE id=?", (value, iso(), u["id"]))
    audit.log(db, action, g.user["id"], None, {"user": pid})
    return jsonify({"ok": True})


@bp.post("/users/<pid>/verify")
@login_required("admin")
def verify(pid):
    return _set(pid, "is_verified", 1, "USER_VERIFIED")


@bp.post("/users/<pid>/deactivate")
@login_required("admin")
def deactivate(pid):
    return _set(pid, "is_active", 0, "USER_DEACTIVATED")


@bp.post("/users/<pid>/activate")
@login_required("admin")
def activate(pid):
    return _set(pid, "is_active", 1, "USER_ACTIVATED")


@bp.get("/audit/verify")
@login_required("admin")
def audit_verify():
    return jsonify(audit.verify_chain(get_db()))
