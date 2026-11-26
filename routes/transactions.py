"""Transaction lifecycle: booking hold, two-party acceptance, access rules, and the detail view.

Status flow (the "state machine"):
  REQUESTED -> AGREED -> IN_TRANSIT -> DELIVERED -> ACCEPTED -> COMPLETED
  any of AGREED..ACCEPTED -> DISPUTED -> (back to the status before the dispute)
  REQUESTED -> EXPIRED / DECLINED ;  REQUESTED or AGREED -> CANCELLED
"""
import json
from datetime import timedelta

from flask import current_app

from .. import audit
from ..common import ApiError, BUYER_ROLES, SELLER_ROLES, iso, new_public_id, now, parse_iso
from .notifier import notify

TERMINAL = ("EXPIRED", "DECLINED", "CANCELLED")
PASSED = ("WITHIN_AGREED_RANGE", "NO_AGREED_RANGE")
DISPUTABLE = ("AGREED", "IN_TRANSIT", "DELIVERED", "ACCEPTED", "COMPLETED")


# ---------- lookup and access ----------
def get_tx(db, pid):
    row = db.execute("SELECT * FROM transactions WHERE public_id=?", (pid,)).fetchone()
    if not row:
        raise ApiError("Transaction not found", 404)
    return row


def get_job(db, tx_id):
    return db.execute("SELECT * FROM delivery_jobs WHERE transaction_id=? AND status!='CANCELLED' "
                      "ORDER BY id DESC LIMIT 1", (tx_id,)).fetchone()


def relation(db, tx, user):
    uid = user["id"]
    rel = {"seller": tx["seller_id"] == uid, "buyer": tx["buyer_id"] == uid, "driver": False,
           "carrier": tx["carrier_id"] == uid, "coop": False, "admin": user["role"] == "admin"}
    job = get_job(db, tx["id"])
    if job and job["assigned_driver_id"] == uid and job["status"] in ("ASSIGNED", "ACCEPTED", "COMPLETED"):
        rel["driver"] = True
    if user["role"] == "coop_admin" and user["cooperative_id"]:
        row = db.execute(
            "SELECT 1 FROM users WHERE id IN (?,?) AND cooperative_id=?",
            (tx["seller_id"], tx["buyer_id"], user["cooperative_id"])).fetchone()
        rel["coop"] = bool(row)
    rel["party"] = rel["seller"] or rel["buyer"]
    rel["any"] = rel["party"] or rel["driver"] or rel["coop"] or rel["admin"]
    return rel


def require_access(db, pid, user, party_only=False):
    sweep_expired(db)
    tx = get_tx(db, pid)
    rel = relation(db, tx, user)
    if not rel["any"] or (party_only and not rel["party"]):
        raise ApiError("Transaction not found", 404)  # 404, not 403, so IDs cannot be probed
    return tx, rel


def touch(db, tx_id, **cols):
    cols["updated_at"] = iso()
    sets = ", ".join(f"{k}=?" for k in cols)
    db.execute(f"UPDATE transactions SET {sets} WHERE id=?", (*cols.values(), tx_id))


def other_party(tx, uid):
    return tx["buyer_id"] if tx["seller_id"] == uid else tx["seller_id"]


# ---------- booking hold ----------
def release_litres(db, tx):
    if tx["listing_id"]:
        db.execute("UPDATE listings SET litres_remaining = litres_remaining + ?, "
                   "status = CASE WHEN status='CLOSED' THEN 'OPEN' ELSE status END WHERE id=?",
                   (tx["litres"], tx["listing_id"]))


def _expire(db, tx):
    cur = db.execute("UPDATE transactions SET status='EXPIRED', updated_at=? WHERE id=? AND status='REQUESTED'",
                     (iso(), tx["id"]))
    if cur.rowcount:
        release_litres(db, tx)
        audit.log(db, "TX_EXPIRED", None, tx["id"], {"reason": "owner did not confirm within the booking hold"})
        notify(db, tx["created_by"], f"Booking {tx['public_id']} expired because the other party did not confirm in time. "
               "You can try again.", f"#/transaction/{tx['public_id']}")


def sweep_expired(db):
    """Turn overdue REQUESTED bookings into EXPIRED and give the litres back to the listing."""
    due = db.execute("SELECT * FROM transactions WHERE status='REQUESTED' AND hold_expires_at < ?", (iso(),)).fetchall()
    if not due:
        return
    own = not db.in_transaction
    if own:
        db.execute("BEGIN IMMEDIATE")
    try:
        for tx in due:
            _expire(db, tx)
        if own:
            db.execute("COMMIT")
    except Exception:
        if own:
            db.execute("ROLLBACK")
        raise


def book(db, listing_pid, user, litres, delivery_at=None):
    sweep_expired(db)
    lst = db.execute("SELECT * FROM listings WHERE public_id=?", (listing_pid,)).fetchone()
    if not lst or lst["status"] == "CANCELLED":
        raise ApiError("Listing not found", 404)
    if lst["owner_id"] == user["id"]:
        raise ApiError("You cannot book your own listing", 409)
    if lst["status"] != "OPEN":
        raise ApiError("This listing is fully booked or closed", 409)
    if lst["available_until"] and parse_iso(lst["available_until"]) < now():
        raise ApiError("This listing is past its available date", 409)
    if lst["listing_type"] == "SELL":
        if user["role"] not in BUYER_ROLES:
            raise ApiError("Only buyers, collectors or cooperatives can book milk for sale", 403)
        seller_id, buyer_id = lst["owner_id"], user["id"]
    else:
        if user["role"] not in SELLER_ROLES:
            raise ApiError("Only farmers, collectors or cooperatives can answer a buy request", 403)
        seller_id, buyer_id = user["id"], lst["owner_id"]
    litres = round(float(litres), 2)
    if litres <= 0 or litres > lst["litres_remaining"] + 1e-9:
        raise ApiError(f"Only {lst['litres_remaining']:g} litres are still available", 409)
    hold = current_app.config["BOOKING_HOLD_SECONDS"]
    ts = iso()
    col = "seller_accepted_at" if seller_id == user["id"] else "buyer_accepted_at"
    pid = new_public_id("AS")
    cur = db.execute(
        f"INSERT INTO transactions (public_id, listing_id, seller_id, buyer_id, created_by, litres, price_per_litre, "
        f"total_value, location_name, district, delivery_at, min_lactometer, max_lactometer, max_temperature_c, "
        f"terms, status, hold_expires_at, {col}, created_at, updated_at) "
        f"VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'REQUESTED',?,?,?,?)",
        (pid, lst["id"], seller_id, buyer_id, user["id"], litres, lst["price_per_litre"],
         round(litres * lst["price_per_litre"]), lst["location_name"], lst["district"],
         delivery_at or lst["available_from"], lst["min_lactometer"], lst["max_lactometer"],
         lst["max_temperature_c"], lst["terms"], iso(now() + timedelta(seconds=hold)), ts, ts, ts))
    remaining = round(lst["litres_remaining"] - litres, 2)
    db.execute("UPDATE listings SET litres_remaining=?, status=? WHERE id=?",
               (remaining, "CLOSED" if remaining <= 0 else "OPEN", lst["id"]))
    audit.log(db, "TX_REQUESTED", user["id"], cur.lastrowid,
              {"litres": litres, "price_per_litre": lst["price_per_litre"], "hold_seconds": hold})
    notify(db, lst["owner_id"], f"New booking {pid}: {litres:g} L. Confirm within {hold} seconds.",
           f"#/transaction/{pid}")
    return pid


def confirm(db, tx, user):
    if tx["status"] != "REQUESTED":
        raise ApiError(f"This deal is {tx['status'].lower()}, not waiting for confirmation", 409)
    if tx["created_by"] == user["id"]:
        raise ApiError("The other party must confirm your request", 409)
    col = "seller_accepted_at" if tx["seller_id"] == user["id"] else "buyer_accepted_at"
    touch(db, tx["id"], status="AGREED", hold_expires_at=None, **{col: iso()})
    audit.log(db, "TX_CONFIRMED", user["id"], tx["id"], {"party": "seller" if col.startswith("seller") else "buyer"})
    notify(db, tx["created_by"], f"Deal {tx['public_id']} confirmed. Next: arrange transport.",
           f"#/transaction/{tx['public_id']}")


def decline(db, tx, user, reason):
    if tx["status"] != "REQUESTED" or tx["created_by"] == user["id"]:
        raise ApiError("Only the other party can decline a waiting request", 409)
    touch(db, tx["id"], status="DECLINED", hold_expires_at=None)
    release_litres(db, tx)
    audit.log(db, "TX_DECLINED", user["id"], tx["id"], {"reason": reason})
    notify(db, tx["created_by"], f"Deal {tx['public_id']} was declined.", f"#/transaction/{tx['public_id']}")


def cancel(db, tx, user, reason):
    if tx["status"] not in ("REQUESTED", "AGREED"):
        raise ApiError("A deal can only be cancelled before the milk is picked up. Open a dispute instead.", 409)
    touch(db, tx["id"], status="CANCELLED", hold_expires_at=None)
    release_litres(db, tx)
    db.execute("UPDATE delivery_jobs SET status='CANCELLED' WHERE transaction_id=? AND status IN ('OPEN','ASSIGNED','ACCEPTED')",
               (tx["id"],))
    audit.log(db, "TX_CANCELLED", user["id"], tx["id"], {"reason": reason})
    notify(db, other_party(tx, user["id"]), f"Deal {tx['public_id']} was cancelled.", f"#/transaction/{tx['public_id']}")


def self_transport(db, tx, user):
    if tx["status"] != "AGREED" or not (tx["seller_id"] == user["id"] or tx["buyer_id"] == user["id"]):
        raise ApiError("Only the seller or buyer of an agreed deal can arrange transport", 409)
    if tx["transport_mode"] == "DRIVER" and get_job(db, tx["id"]):
        raise ApiError("A driver job already exists. Cancel it first.", 409)
    touch(db, tx["id"], transport_mode="SELF", carrier_id=user["id"])
    audit.log(db, "TRANSPORT_SELF", user["id"], tx["id"], {})


# ---------- serialisation ----------
def _party(db, uid, show_phone):
    u = db.execute("SELECT public_id, full_name, business_name, role, district, sector, phone, is_verified "
                   "FROM users WHERE id=?", (uid,)).fetchone()
    d = {k: u[k] for k in ("public_id", "full_name", "business_name", "role", "district", "sector")}
    d["is_verified"] = bool(u["is_verified"])
    if show_phone:
        d["phone"] = u["phone"]
    return d


def evidence_list(db, tx_id):
    out = []
    for e in db.execute(
            "SELECT e.*, u.full_name AS by_name, u.role AS by_role FROM evidence e JOIN users u ON u.id=e.submitted_by "
            "WHERE e.transaction_id=? ORDER BY e.id", (tx_id,)):
        out.append({"id": e["public_id"], "category": e["category"], "submitted_by": e["by_name"], "submitted_by_role": e["by_role"],
                    "original_filename": e["original_filename"], "mime_type": e["mime_type"], "size_bytes": e["size_bytes"],
                    "sha256": e["sha256"], "captured_at": e["captured_at"], "latitude": e["latitude"],
                    "longitude": e["longitude"], "note": e["note"], "created_at": e["created_at"],
                    "is_image": e["mime_type"].startswith("image/"), "url": f"/api/evidence/{e['public_id']}/file"})
    return out


def quality_list(db, tx_id):
    out = []
    for q in db.execute(
            "SELECT q.*, u.full_name AS by_name, e.public_id AS ev FROM quality_checks q "
            "JOIN users u ON u.id=q.recorded_by LEFT JOIN evidence e ON e.id=q.evidence_id "
            "WHERE q.transaction_id=? ORDER BY q.id", (tx_id,)):
        out.append({"id": q["public_id"], "stage": q["stage"], "recorded_by": q["by_name"], "tester_name": q["tester_name"],
                    "reading_sg": q["reading_sg"], "temperature_c": q["temperature_c"], "tested_at": q["tested_at"],
                    "photo_legible": bool(q["photo_legible"]), "result": q["result"], "result_detail": q["result_detail"],
                    "evidence_id": q["ev"], "waived": bool(q["waived_at"]), "waiver_note": q["waiver_note"],
                    "created_at": q["created_at"]})
    return out


def payments_list(db, tx_id, user):
    out = []
    for p in db.execute(
            "SELECT p.*, a.full_name AS payer_name, b.full_name AS payee_name, e.public_id AS proof "
            "FROM payments p JOIN users a ON a.id=p.payer_id JOIN users b ON b.id=p.payee_id "
            "LEFT JOIN evidence e ON e.id=p.proof_evidence_id WHERE p.transaction_id=? ORDER BY p.id", (tx_id,)):
        mine_payer, mine_payee = p["payer_id"] == user["id"], p["payee_id"] == user["id"]
        item = {"id": p["public_id"], "purpose": p["purpose"], "payer": p["payer_name"], "payee": p["payee_name"],
                "amount_due_rwf": p["amount_due_rwf"], "amount_reported_rwf": p["amount_reported_rwf"],
                "method_type": p["method_type"], "method_detail": p["method_detail"], "reference": p["reference"],
                "proof_evidence_id": p["proof"], "status": p["status"], "reported_at": p["reported_at"],
                "confirmed_at": p["confirmed_at"], "rejected_at": p["rejected_at"],
                "rejection_reason": p["rejection_reason"], "created_at": p["created_at"],
                "i_am_payer": mine_payer, "i_am_payee": mine_payee, "actions": []}
        if mine_payer and (p["status"] == "REQUESTED" or (p["status"] == "REJECTED" and p["purpose"] == "TRANSPORT")):
            item["actions"].append("report")
            item["payee_methods"] = [dict(m) for m in db.execute(
                "SELECT method_type, label, account_value FROM payment_methods WHERE user_id=? AND is_active=1",
                (p["payee_id"],))]
        if mine_payee and p["status"] == "REPORTED":
            item["actions"] += ["confirm", "reject"]
        out.append(item)
    return out


def ai_list(db, tx_id):
    out = []
    for a in db.execute("SELECT a.*, e.public_id AS ev FROM ai_analyses a LEFT JOIN evidence e ON e.id=a.evidence_id "
                        "WHERE a.transaction_id=? ORDER BY a.id", (tx_id,)):
        out.append({"id": a["public_id"], "kind": a["kind"], "evidence_id": a["ev"], "status": a["status"],
                    "model": a["model"], "language": a["language"],
                    "extracted": json.loads(a["extracted_json"]) if a["extracted_json"] else None,
                    "confirmed": json.loads(a["confirmed_json"]) if a["confirmed_json"] else None,
                    "created_at": a["created_at"],
                    "disclaimer": "AI output is a suggestion. A person must check it against the original file."})
    return out


def timeline(db, tx_id):
    out = []
    for a in db.execute("SELECT a.*, u.full_name, u.role FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id "
                        "WHERE a.transaction_id=? ORDER BY a.id", (tx_id,)):
        out.append({"at": a["created_at"], "action": a["action"], "actor": a["full_name"] or "System",
                    "actor_role": a["role"], "details": json.loads(a["details_json"])})
    return out


def disputes_brief(db, tx_id):
    return [dict(d) for d in db.execute(
        "SELECT public_id AS id, category, status, created_at FROM disputes WHERE transaction_id=? ORDER BY id", (tx_id,))]


def actions_for(db, tx, rel, user, job, checks):
    a, st, uid = [], tx["status"], user["id"]
    party = rel["party"]
    creator = tx["created_by"] == uid
    transport_ready = tx["transport_mode"] == "SELF" or (job is not None and job["status"] == "ACCEPTED")
    open_dispute = db.execute("SELECT 1 FROM disputes WHERE transaction_id=? AND status='OPEN'", (tx["id"],)).fetchone()
    if party and st == "REQUESTED":
        a += ["cancel"] if creator else ["confirm", "decline"]
    if party and st == "AGREED":
        a.append("cancel")
        if tx["transport_mode"] == "UNDECIDED" or (tx["transport_mode"] == "DRIVER" and job is None):
            a += ["post_job", "self_transport"]
        elif tx["transport_mode"] == "SELF" and rel["carrier"]:
            pass
    if st == "AGREED" and transport_ready:
        driver_ok = (not rel["driver"]) or (job and job["stage"] == "AT_FARMER")
        if (rel["seller"] or rel["carrier"]) and driver_ok:
            a.append("record_pickup_quality")
        last = [c for c in checks if c["stage"] == "PICKUP"]
        if rel["buyer"] and last and last[-1]["result"] == "OUTSIDE_AGREED_RANGE" and not last[-1]["waived"]:
            a.append("waive_quality")
    if st == "AGREED" and rel["driver"] and job and job["status"] == "ACCEPTED" and job["stage"] == "NOT_STARTED":
        a.append("driver_arrived_farmer")
    if st == "IN_TRANSIT" and rel["carrier"]:
        a.append("mark_arrived")
    if st == "DELIVERED":
        if rel["buyer"] or rel["carrier"]:
            a.append("record_arrival_quality")
        if rel["buyer"]:
            a.append("decide")
    if party and st in DISPUTABLE and not open_dispute:
        a.append("open_dispute")
    if (party or rel["driver"]) and st not in TERMINAL:
        a.append("upload_evidence")
    if party:
        a.append("ai_summary")
    return a


def detail(db, tx, user, rel):
    contact_ok = rel["party"] or rel["admin"] or (rel["driver"] and tx["carrier_id"] == user["id"])
    job = get_job(db, tx["id"])
    checks = quality_list(db, tx["id"])
    d = {
        "id": tx["public_id"], "status": tx["status"], "payment_status": tx["payment_status"],
        "seller": _party(db, tx["seller_id"], contact_ok), "buyer": _party(db, tx["buyer_id"], contact_ok),
        "created_by_role": "seller" if tx["created_by"] == tx["seller_id"] else "buyer",
        "litres": tx["litres"], "accepted_litres": tx["accepted_litres"], "price_per_litre": tx["price_per_litre"],
        "total_value": tx["total_value"], "location_name": tx["location_name"], "district": tx["district"],
        "delivery_at": tx["delivery_at"],
        "quality_requirements": {"min_lactometer": tx["min_lactometer"], "max_lactometer": tx["max_lactometer"],
                                 "max_temperature_c": tx["max_temperature_c"]},
        "terms": tx["terms"], "transport_mode": tx["transport_mode"], "hold_expires_at": tx["hold_expires_at"],
        "seller_accepted_at": tx["seller_accepted_at"], "buyer_accepted_at": tx["buyer_accepted_at"],
        "created_at": tx["created_at"], "updated_at": tx["updated_at"],
        "my_relation": [k for k in ("seller", "buyer", "driver", "carrier", "coop", "admin") if rel[k]],
        "actions": [] if (rel["coop"] or rel["admin"]) and not rel["party"] else actions_for(db, tx, rel, user, job, checks),
        "quality_checks": checks, "evidence": evidence_list(db, tx["id"]),
        "payments": payments_list(db, tx["id"], user), "disputes": disputes_brief(db, tx["id"]),
        "ai": ai_list(db, tx["id"]), "timeline": timeline(db, tx["id"]),
        "job": None,
    }
    if job:
        from .delivery import job_dict
        d["job"] = job_dict(db, job, user, rel)
    return d


def list_for_user(db, user, status=None):
    sweep_expired(db)
    role = user["role"]
    if role == "admin":
        where, args = "1=1", []
    elif role == "coop_admin" and user["cooperative_id"]:
        where = ("(t.seller_id=? OR t.buyer_id=? OR t.seller_id IN (SELECT id FROM users WHERE cooperative_id=?) "
                 "OR t.buyer_id IN (SELECT id FROM users WHERE cooperative_id=?))")
        args = [user["id"], user["id"], user["cooperative_id"], user["cooperative_id"]]
    elif role == "driver":
        where = "t.id IN (SELECT transaction_id FROM delivery_jobs WHERE assigned_driver_id=? AND status IN ('ASSIGNED','ACCEPTED','COMPLETED'))"
        args = [user["id"]]
    else:
        where, args = "(t.seller_id=? OR t.buyer_id=?)", [user["id"], user["id"]]
    if status:
        where += " AND t.status=?"
        args.append(status)
    q = ("SELECT t.*, s.full_name AS seller_name, b.full_name AS buyer_name FROM transactions t "
         "JOIN users s ON s.id=t.seller_id JOIN users b ON b.id=t.buyer_id WHERE " + where +
         " ORDER BY t.updated_at DESC, t.id DESC LIMIT 200")
    return [{"id": r["public_id"], "status": r["status"], "payment_status": r["payment_status"],
             "seller_name": r["seller_name"], "buyer_name": r["buyer_name"], "litres": r["litres"],
             "price_per_litre": r["price_per_litre"], "total_value": r["total_value"],
             "location_name": r["location_name"], "delivery_at": r["delivery_at"],
             "hold_expires_at": r["hold_expires_at"], "updated_at": r["updated_at"],
             "created_by_me": r["created_by"] == user["id"]}
            for r in db.execute(q, args)]
