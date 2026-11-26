"""Role dashboards and notifications."""
from flask import Blueprint, g, jsonify, request

from ..database import get_db
from ..security import login_required
from ..services import transactions as T

bp = Blueprint("dashboard", __name__, url_prefix="/api")


def _tx_stats(db, user):
    rows = T.list_for_user(db, user)
    by = {}
    for r in rows:
        by[r["status"]] = by.get(r["status"], 0) + 1
    uid = user["id"]
    active_states = ("REQUESTED", "AGREED", "IN_TRANSIT", "DELIVERED", "ACCEPTED", "DISPUTED")
    done = db.execute("SELECT COUNT(*) n, COALESCE(SUM(accepted_litres),0) l, COALESCE(SUM(ROUND(accepted_litres*price_per_litre)),0) v "
                      "FROM transactions WHERE status='COMPLETED' AND (seller_id=? OR buyer_id=?)", (uid, uid)).fetchone()
    return rows, {
        "total": len(rows), "by_status": by,
        "active": sum(by.get(s, 0) for s in active_states), "completed": by.get("COMPLETED", 0),
        "pending_acceptance": sum(1 for r in rows if r["status"] == "REQUESTED" and not r["created_by_me"]),
        "waiting_for_other_party": sum(1 for r in rows if r["status"] == "REQUESTED" and r["created_by_me"]),
        "pending_delivery": by.get("AGREED", 0) + by.get("IN_TRANSIT", 0),
        "payments_unconfirmed": sum(1 for r in rows if r["status"] == "ACCEPTED" and r["payment_status"] != "CONFIRMED_BY_BOTH"),
        "disputed": by.get("DISPUTED", 0),
        "completed_litres": done["l"], "completed_value_rwf": done["v"]}


@bp.get("/dashboard")
@login_required()
def dashboard():
    db, u = get_db(), g.user
    out = {"role": u["role"], "name": u["full_name"]}
    if u["role"] == "admin":
        out["admin"] = {k: db.execute(q).fetchone()[0] for k, q in {
            "users": "SELECT COUNT(*) FROM users", "unverified_users": "SELECT COUNT(*) FROM users WHERE is_verified=0 AND role!='admin'",
            "transactions": "SELECT COUNT(*) FROM transactions", "open_disputes": "SELECT COUNT(*) FROM disputes WHERE status='OPEN'",
            "evidence_files": "SELECT COUNT(*) FROM evidence"}.items()}
    rows, stats = _tx_stats(db, u)
    out["stats"], out["recent"] = stats, rows[:6]
    todo = []
    for r in rows:
        if r["status"] == "REQUESTED" and not r["created_by_me"]:
            todo.append({"tx": r["id"], "text": "Confirm or decline this booking"})
    n = db.execute("SELECT COUNT(*) FROM payments WHERE payee_id=? AND status='REPORTED'", (u["id"],)).fetchone()[0]
    if n:
        todo.append({"text": f"{n} payment(s) waiting for you to confirm receipt"})
    n = db.execute("SELECT COUNT(*) FROM payments p JOIN transactions t ON t.id=p.transaction_id WHERE p.payer_id=? AND p.status='REQUESTED' AND t.status='ACCEPTED'", (u["id"],)).fetchone()[0]
    if n:
        todo.append({"text": f"{n} payment(s) to report as paid"})
    n = db.execute("SELECT COUNT(*) FROM transactions WHERE buyer_id=? AND status='DELIVERED'", (u["id"],)).fetchone()[0]
    if n:
        todo.append({"text": f"{n} delivery(ies) waiting for your check and decision"})
    out["todo"] = todo
    if u["role"] == "driver":
        out["driver"] = {"open_jobs": db.execute("SELECT COUNT(*) FROM delivery_jobs j JOIN transactions t ON t.id=j.transaction_id "
                                                 "WHERE j.status='OPEN' AND t.status='AGREED'").fetchone()[0],
                         "my_active_jobs": db.execute("SELECT COUNT(*) FROM delivery_jobs WHERE assigned_driver_id=? AND status IN ('ASSIGNED','ACCEPTED')", (u["id"],)).fetchone()[0],
                         "completed_jobs": db.execute("SELECT COUNT(*) FROM delivery_jobs WHERE assigned_driver_id=? AND status='COMPLETED'", (u["id"],)).fetchone()[0]}
    out["unread_notifications"] = db.execute("SELECT COUNT(*) FROM notifications WHERE user_id=? AND is_read=0", (u["id"],)).fetchone()[0]
    return jsonify(out)


@bp.get("/notifications")
@login_required()
def notifications():
    return jsonify([dict(r) for r in get_db().execute(
        "SELECT id, message, link, is_read, created_at FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50", (g.user["id"],))])


@bp.post("/notifications/read")
@login_required()
def mark_read():
    get_db().execute("UPDATE notifications SET is_read=1 WHERE user_id=?", (g.user["id"],))
    return jsonify({"ok": True})
