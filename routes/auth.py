"""Registration, login, logout, current user, and account management."""
from flask import Blueprint, g, jsonify, request, session

from .. import audit
from ..common import (REGISTERABLE_ROLES, ApiError, check_password_strength, field, iso, json_body, new_public_id,
                      normalise_phone)
from ..database import get_db
from ..security import (hash_password, login_required, throttle_check, throttle_clear, throttle_fail, verify_password)
from flask import current_app

bp = Blueprint("auth", __name__, url_prefix="/api")


def user_json(db, u):
    coop = None
    if u["cooperative_id"]:
        c = db.execute("SELECT id, name FROM cooperatives WHERE id=?", (u["cooperative_id"],)).fetchone()
        coop = dict(c) if c else None
    return {"id": u["public_id"], "full_name": u["full_name"], "phone": u["phone"], "email": u["email"], "role": u["role"],
            "business_name": u["business_name"], "district": u["district"], "sector": u["sector"],
            "latitude": u["latitude"], "longitude": u["longitude"], "vehicle_type": u["vehicle_type"],
            "cooperative": coop, "is_verified": bool(u["is_verified"]), "created_at": u["created_at"]}


@bp.get("/cooperatives")
def cooperatives():
    return jsonify([dict(r) for r in get_db().execute("SELECT id, name, district FROM cooperatives ORDER BY name")])


@bp.post("/auth/register")
def register():
    db, d = get_db(), json_body()
    role = field(d, "role", choices=sorted(REGISTERABLE_ROLES))
    name = field(d, "full_name", maxlen=100)
    if len(name) < 2:
        raise ApiError("Enter your full name", 422)
    phone = normalise_phone(d.get("phone"))
    pw = d.get("password")
    check_password_strength(pw)
    if field(d, "consent", "bool", required=False, default=False) is not True:
        raise ApiError("You must accept the privacy notice to create an account", 422)
    if db.execute("SELECT 1 FROM users WHERE phone=?", (phone,)).fetchone():
        raise ApiError("An account with this phone number already exists", 409)
    coop_id = None
    if role == "coop_admin":
        cname = field(d, "cooperative_name", maxlen=120)
        row = db.execute("SELECT id FROM cooperatives WHERE name=?", (cname,)).fetchone()
        coop_id = row["id"] if row else db.execute("INSERT INTO cooperatives (name, district, created_at) VALUES (?,?,?)",
                                                    (cname, field(d, "district", required=False), iso())).lastrowid
    elif d.get("cooperative_id") not in (None, ""):
        cid = field(d, "cooperative_id", "int")
        if not db.execute("SELECT 1 FROM cooperatives WHERE id=?", (cid,)).fetchone():
            raise ApiError("Cooperative not found", 404)
        coop_id = cid
    ts = iso()
    pid = new_public_id("U")
    cur = db.execute(
        "INSERT INTO users (public_id, full_name, phone, email, password_hash, role, business_name, district, sector, "
        "latitude, longitude, cooperative_id, vehicle_type, consent_at, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (pid, name, phone, field(d, "email", required=False, maxlen=120), hash_password(pw), role,
         field(d, "business_name", required=False, maxlen=120), field(d, "district", required=False, maxlen=60),
         field(d, "sector", required=False, maxlen=60), field(d, "latitude", "float", required=False, min=-90, max=90),
         field(d, "longitude", "float", required=False, min=-180, max=180), coop_id,
         field(d, "vehicle_type", required=False, maxlen=40) if role == "driver" else None, ts, ts, ts))
    audit.log(db, "USER_REGISTERED", cur.lastrowid, None, {"role": role})
    session.clear()
    session["uid"] = cur.lastrowid
    session.permanent = True
    u = db.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify({"user": user_json(db, u)}), 201


@bp.post("/auth/login")
def login():
    db, d = get_db(), json_body()
    phone = normalise_phone(d.get("phone"))
    key = (phone, request.remote_addr)
    throttle_check(current_app.config, key)
    u = db.execute("SELECT * FROM users WHERE phone=? AND is_active=1", (phone,)).fetchone()
    if not u or not verify_password(u["password_hash"], str(d.get("password") or "")):
        throttle_fail(key)
        raise ApiError("Wrong phone number or password", 401)
    throttle_clear(key)
    session.clear()
    session["uid"] = u["id"]
    session.permanent = True
    return jsonify({"user": user_json(db, u)})


@bp.post("/auth/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@bp.get("/auth/me")
@login_required()
def me():
    return jsonify({"user": user_json(get_db(), g.user)})


@bp.patch("/users/me")
@login_required()
def update_me():
    db, d = get_db(), json_body()
    u = g.user
    vals = {
        "full_name": field(d, "full_name", required=False, default=u["full_name"], maxlen=100),
        "email": field(d, "email", required=False, default=u["email"], maxlen=120),
        "business_name": field(d, "business_name", required=False, default=u["business_name"], maxlen=120),
        "district": field(d, "district", required=False, default=u["district"], maxlen=60),
        "sector": field(d, "sector", required=False, default=u["sector"], maxlen=60),
        "latitude": field(d, "latitude", "float", required=False, default=u["latitude"], min=-90, max=90),
        "longitude": field(d, "longitude", "float", required=False, default=u["longitude"], min=-180, max=180),
        "vehicle_type": field(d, "vehicle_type", required=False, default=u["vehicle_type"], maxlen=40),
    }
    db.execute("UPDATE users SET full_name=?, email=?, business_name=?, district=?, sector=?, latitude=?, longitude=?, "
               "vehicle_type=?, updated_at=? WHERE id=?", (*vals.values(), iso(), u["id"]))
    audit.log(db, "PROFILE_UPDATED", u["id"], None, {})
    return jsonify({"user": user_json(db, db.execute("SELECT * FROM users WHERE id=?", (u["id"],)).fetchone())})


@bp.post("/users/me/password")
@login_required()
def change_password():
    db, d = get_db(), json_body()
    if not verify_password(g.user["password_hash"], str(d.get("current_password") or "")):
        raise ApiError("Current password is wrong", 403)
    check_password_strength(d.get("new_password"))
    db.execute("UPDATE users SET password_hash=?, updated_at=? WHERE id=?", (hash_password(d["new_password"]), iso(), g.user["id"]))
    audit.log(db, "PASSWORD_CHANGED", g.user["id"], None, {})
    return jsonify({"ok": True})


@bp.get("/users/me/payment-methods")
@login_required()
def list_methods():
    return jsonify([dict(r) for r in get_db().execute(
        "SELECT id, method_type, label, account_value FROM payment_methods WHERE user_id=? AND is_active=1 ORDER BY id", (g.user["id"],))])


@bp.post("/users/me/payment-methods")
@login_required()
def add_method():
    d = json_body()
    db = get_db()
    mt = field(d, "method_type", choices=("momo_code", "momo_phone", "bank", "other"))
    cur = db.execute("INSERT INTO payment_methods (user_id, method_type, label, account_value, created_at) VALUES (?,?,?,?,?)",
                     (g.user["id"], mt, field(d, "label", maxlen=60), field(d, "account_value", maxlen=80), iso()))
    return jsonify({"id": cur.lastrowid}), 201


@bp.delete("/users/me/payment-methods/<int:mid>")
@login_required()
def delete_method(mid):
    cur = get_db().execute("UPDATE payment_methods SET is_active=0 WHERE id=? AND user_id=?", (mid, g.user["id"]))
    if not cur.rowcount:
        raise ApiError("Payment method not found", 404)
    return jsonify({"ok": True})
