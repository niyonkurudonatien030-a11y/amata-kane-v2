"""Marketplace listings: farmers post milk for sale, buyers post requests; others filter and book."""
from flask import Blueprint, g, jsonify, request

from .. import audit
from ..common import ApiError, BUYER_ROLES, SELLER_ROLES, field, iso, json_body, new_public_id, now, parse_iso
from ..database import get_db
from ..security import login_required
from ..services import transactions as T
from ..services.matching import haversine_km

bp = Blueprint("listings", __name__, url_prefix="/api")


def listing_json(db, r, viewer, distance=None):
    o = db.execute("SELECT full_name, business_name, role, district, is_verified FROM users WHERE id=?", (r["owner_id"],)).fetchone()
    return {"id": r["public_id"], "listing_type": r["listing_type"], "litres_total": r["litres_total"],
            "litres_remaining": r["litres_remaining"], "price_per_litre": r["price_per_litre"],
            "location_name": r["location_name"], "district": r["district"], "latitude": r["latitude"], "longitude": r["longitude"],
            "available_from": r["available_from"], "available_until": r["available_until"],
            "quality_requirements": {"min_lactometer": r["min_lactometer"], "max_lactometer": r["max_lactometer"],
                                     "max_temperature_c": r["max_temperature_c"]},
            "terms": r["terms"], "status": r["status"], "created_at": r["created_at"], "mine": r["owner_id"] == viewer["id"],
            "distance_km": round(distance, 1) if distance is not None else None,
            "owner": {"name": o["business_name"] or o["full_name"], "role": o["role"], "district": o["district"],
                      "is_verified": bool(o["is_verified"])},
            "can_book": r["status"] == "OPEN" and r["owner_id"] != viewer["id"] and (
                viewer["role"] in (BUYER_ROLES if r["listing_type"] == "SELL" else SELLER_ROLES))}


@bp.post("/listings")
@login_required("farmer", "buyer", "collector", "coop_admin")
def create_listing():
    db, d, u = get_db(), json_body(), g.user
    ltype = field(d, "listing_type", choices=("SELL", "BUY"))
    allowed = SELLER_ROLES if ltype == "SELL" else BUYER_ROLES
    if u["role"] not in allowed:
        raise ApiError("Your account role cannot post this kind of listing", 403)
    litres = field(d, "litres", "float", min=1, max=100000)
    price = field(d, "price_per_litre", "int", min=1, max=100000)
    lo = field(d, "min_lactometer", "float", required=False, min=1.0, max=1.1)
    hi = field(d, "max_lactometer", "float", required=False, min=1.0, max=1.1)
    if lo is not None and hi is not None and lo > hi:
        raise ApiError("Minimum lactometer reading cannot be above the maximum", 422)
    lat = field(d, "latitude", "float", required=False, min=-90, max=90)
    lon = field(d, "longitude", "float", required=False, min=-180, max=180)
    if (lat is None) != (lon is None):
        raise ApiError("Give both latitude and longitude, or neither", 422)
    avail_from = field(d, "available_from", "datetime", required=False, default=iso())
    until_raw = field(d, "available_until", required=False)
    until = None
    if until_raw:
        until = iso(parse_iso(until_raw + "T23:59:59Z" if len(until_raw) == 10 else until_raw))
        if until < avail_from:
            raise ApiError("'available_until' must be after 'available_from'", 422)
    pid = new_public_id("L")
    cur = db.execute(
        "INSERT INTO listings (public_id, listing_type, owner_id, litres_total, litres_remaining, price_per_litre, location_name, "
        "district, latitude, longitude, available_from, available_until, min_lactometer, max_lactometer, max_temperature_c, terms, created_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (pid, ltype, u["id"], litres, litres, price, field(d, "location_name", maxlen=120),
         field(d, "district", required=False, default=u["district"], maxlen=60), lat, lon, avail_from, until, lo, hi,
         field(d, "max_temperature_c", "float", required=False, min=0, max=60), field(d, "terms", required=False, maxlen=1000), iso()))
    audit.log(db, "LISTING_CREATED", u["id"], None, {"listing": pid, "type": ltype, "litres": litres})
    r = db.execute("SELECT * FROM listings WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(listing_json(db, r, u)), 201


@bp.get("/listings")
@login_required()
def search_listings():
    db, u, a = get_db(), g.user, request.args
    T.sweep_expired(db)
    q, args = "SELECT * FROM listings WHERE 1=1", []
    if a.get("mine") == "1":
        q += " AND owner_id=?"
        args.append(u["id"])
    else:
        q += " AND status='OPEN' AND owner_id!=? AND (available_until IS NULL OR available_until>=?)"
        args += [u["id"], iso()]
    if a.get("type") in ("SELL", "BUY"):
        q += " AND listing_type=?"
        args.append(a["type"])
    num = lambda k: float(a[k]) if a.get(k) not in (None, "") else None
    try:
        min_l, max_p, min_p, near_lat, near_lon, max_km = (num(k) for k in
                                                            ("min_litres", "max_price", "min_price", "near_lat", "near_lng", "max_km"))
    except ValueError:
        raise ApiError("Filters must be numbers", 422)
    if min_l is not None:
        q += " AND litres_remaining>=?"
        args.append(min_l)
    if max_p is not None:
        q += " AND price_per_litre<=?"
        args.append(max_p)
    if min_p is not None:
        q += " AND price_per_litre>=?"
        args.append(min_p)
    if a.get("district"):
        q += " AND district=?"
        args.append(a["district"].strip())
    items = []
    for r in db.execute(q + " ORDER BY id DESC LIMIT 300", args):
        dist = None
        if near_lat is not None and near_lon is not None and r["latitude"] is not None:
            dist = haversine_km(near_lat, near_lon, r["latitude"], r["longitude"])
            if max_km is not None and dist > max_km:
                continue
        elif max_km is not None and near_lat is not None:
            continue
        items.append((r, dist))
    sort = a.get("sort", "newest")
    if sort == "price_asc":
        items.sort(key=lambda x: x[0]["price_per_litre"])
    elif sort == "price_desc":
        items.sort(key=lambda x: -x[0]["price_per_litre"])
    elif sort == "litres":
        items.sort(key=lambda x: -x[0]["litres_remaining"])
    elif sort == "nearest":
        items.sort(key=lambda x: (x[1] is None, x[1] or 0))
    return jsonify([listing_json(db, r, u, dist) for r, dist in items])


@bp.get("/listings/<pid>")
@login_required()
def get_listing(pid):
    db = get_db()
    r = db.execute("SELECT * FROM listings WHERE public_id=?", (pid,)).fetchone()
    if not r:
        raise ApiError("Listing not found", 404)
    return jsonify(listing_json(db, r, g.user))


@bp.post("/listings/<pid>/book")
@login_required("farmer", "buyer", "collector", "coop_admin")
def book(pid):
    db, d = get_db(), json_body()
    litres = field(d, "litres", "float", min=0.5)
    delivery_at = field(d, "delivery_at", "datetime", required=False)
    tx_pid = T.book(db, pid, g.user, litres, delivery_at)
    tx = T.get_tx(db, tx_pid)
    return jsonify(T.detail(db, tx, g.user, T.relation(db, tx, g.user))), 201


@bp.post("/listings/<pid>/cancel")
@login_required()
def cancel_listing(pid):
    db = get_db()
    r = db.execute("SELECT * FROM listings WHERE public_id=? AND owner_id=?", (pid, g.user["id"])).fetchone()
    if not r:
        raise ApiError("Listing not found", 404)
    db.execute("UPDATE listings SET status='CANCELLED' WHERE id=?", (r["id"],))
    audit.log(db, "LISTING_CANCELLED", g.user["id"], None, {"listing": pid})
    return jsonify({"ok": True})
