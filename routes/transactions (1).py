"""Deal (transaction) endpoints: view, confirm, transport, quality checks, arrival, decision, evidence, disputes."""
from flask import Blueprint, Response, current_app, g, jsonify, request

from ..common import ApiError, field, iso, json_body
from ..database import get_db
from ..security import login_required
from ..services import delivery as DL
from ..services import disputes as D
from ..services import evidence as EV
from ..services import storage
from ..services import transactions as T
from ..services import workflow as W

bp = Blueprint("transactions", __name__, url_prefix="/api")


def tx_response(db, pid, status=200):
    tx = T.get_tx(db, pid)
    return jsonify(T.detail(db, tx, g.user, T.relation(db, tx, g.user))), status


@bp.get("/transactions")
@login_required()
def list_transactions():
    return jsonify(T.list_for_user(get_db(), g.user, request.args.get("status") or None))


@bp.get("/transactions/<pid>")
@login_required()
def get_transaction(pid):
    db = get_db()
    tx, rel = T.require_access(db, pid, g.user)
    return jsonify(T.detail(db, tx, g.user, rel))


@bp.post("/transactions/<pid>/confirm")
@login_required()
def confirm(pid):
    db = get_db()
    tx, _ = T.require_access(db, pid, g.user, party_only=True)
    T.confirm(db, tx, g.user)
    return tx_response(db, pid)


@bp.post("/transactions/<pid>/decline")
@login_required()
def decline(pid):
    db, d = get_db(), json_body()
    tx, _ = T.require_access(db, pid, g.user, party_only=True)
    T.decline(db, tx, g.user, field(d, "reason", required=False, default="", maxlen=300))
    return tx_response(db, pid)


@bp.post("/transactions/<pid>/cancel")
@login_required()
def cancel(pid):
    db, d = get_db(), json_body()
    tx, _ = T.require_access(db, pid, g.user, party_only=True)
    T.cancel(db, tx, g.user, field(d, "reason", required=False, default="", maxlen=300))
    return tx_response(db, pid)


@bp.post("/transactions/<pid>/transport/self")
@login_required()
def transport_self(pid):
    db = get_db()
    tx, _ = T.require_access(db, pid, g.user, party_only=True)
    T.self_transport(db, tx, g.user)
    return tx_response(db, pid)


@bp.post("/transactions/<pid>/job")
@login_required()
def post_job(pid):
    db, d = get_db(), json_body()
    tx, _ = T.require_access(db, pid, g.user, party_only=True)
    DL.post_job(db, tx, g.user, field(d, "wage_rwf", "int", min=0, max=10000000),
                field(d, "contact_method", required=False, default="app", choices=("app", "phone", "sms", "whatsapp")),
                field(d, "vehicle_pref", required=False, maxlen=60), field(d, "dropoff_name", required=False, maxlen=120),
                field(d, "notes", required=False, maxlen=500))
    return tx_response(db, pid, 201)


@bp.post("/transactions/<pid>/driver-arrived")
@login_required("driver")
def driver_arrived(pid):
    db = get_db()
    tx, _ = T.require_access(db, pid, g.user)
    DL.arrived_farmer(db, tx, g.user)
    return tx_response(db, pid)


@bp.post("/transactions/<pid>/quality")
@login_required()
def quality(pid):
    db, d = get_db(), json_body()
    tx, rel = T.require_access(db, pid, g.user)
    legible = field(d, "photo_legible", "bool", required=False, default=True)
    result = W.record_quality(
        db, tx, rel, g.user, field(d, "stage", choices=("PICKUP", "ARRIVAL")), field(d, "evidence_id"),
        field(d, "reading_sg", "float", required=legible, min=0.9, max=1.2),
        field(d, "temperature_c", "float", required=False, min=-5, max=80),
        field(d, "tested_at", "datetime", required=False, default=iso()), legible,
        field(d, "tester_name", required=False, default=g.user["full_name"], maxlen=100))
    return jsonify({**result, "transaction": T.detail(db, T.get_tx(db, pid), g.user, T.relation(db, T.get_tx(db, pid), g.user))}), 201


@bp.post("/transactions/<pid>/quality/waive")
@login_required()
def waive(pid):
    db, d = get_db(), json_body()
    tx, rel = T.require_access(db, pid, g.user, party_only=True)
    W.waive(db, tx, rel, g.user, field(d, "note", maxlen=300))
    return tx_response(db, pid)


@bp.post("/transactions/<pid>/arrived")
@login_required()
def arrived(pid):
    db = get_db()
    tx, rel = T.require_access(db, pid, g.user)
    W.mark_arrived(db, tx, rel, g.user)
    return tx_response(db, pid)


@bp.post("/transactions/<pid>/decision")
@login_required()
def decision(pid):
    db, d = get_db(), json_body()
    tx, rel = T.require_access(db, pid, g.user, party_only=True)
    dec = field(d, "decision", choices=("accept", "reject"))
    W.decide(db, tx, rel, g.user, dec, field(d, "accepted_litres", "float", required=False, min=0.01),
             field(d, "reason", required=False, maxlen=500),
             field(d, "category", required=False, default="quality", choices=("quality", "quantity", "delivery", "price", "other")))
    return tx_response(db, pid)


# ----- evidence -----
@bp.post("/transactions/<pid>/evidence")
@login_required()
def upload_evidence(pid):
    db = get_db()
    tx, rel = T.require_access(db, pid, g.user)
    ev_pid = EV.upload(db, tx, rel, g.user, request.form, request.files.get("file"))
    return jsonify({"id": ev_pid, "transaction": T.detail(db, tx, g.user, rel)}), 201


@bp.get("/transactions/<pid>/evidence")
@login_required()
def list_evidence(pid):
    db = get_db()
    tx, _ = T.require_access(db, pid, g.user)
    return jsonify(T.evidence_list(db, tx["id"]))


@bp.get("/evidence/<ev_pid>/file")
@login_required()
def evidence_file(ev_pid):
    db = get_db()
    e = db.execute("SELECT e.*, t.public_id AS tx FROM evidence e JOIN transactions t ON t.id=e.transaction_id "
                   "WHERE e.public_id=?", (ev_pid,)).fetchone()
    if not e:
        raise ApiError("Evidence not found", 404)
    T.require_access(db, e["tx"], g.user)  # same access rule as the deal itself
    path = storage.resolve_path(current_app.config["EVIDENCE_DIR"], e["stored_filename"])
    if not path.exists():
        raise ApiError("The stored file is missing", 404)
    return Response(path.read_bytes(), mimetype=e["mime_type"], headers={
        "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff",
        "Content-Disposition": f'inline; filename="{ev_pid}{path.suffix}"'})


# ----- disputes opened from a deal -----
@bp.post("/transactions/<pid>/disputes")
@login_required()
def open_dispute(pid):
    db, d = get_db(), json_body()
    tx, _ = T.require_access(db, pid, g.user, party_only=True)
    dp = D.open_dispute(db, tx, g.user, field(d, "category", choices=("quality", "quantity", "payment", "delivery", "price", "other")),
                        field(d, "description", maxlen=1000))
    return jsonify({"id": dp}), 201


# ----- driver jobs -----
@bp.get("/jobs")
@login_required("driver")
def open_jobs():
    a = request.args
    try:
        min_wage = int(a["min_wage"]) if a.get("min_wage") else None
    except ValueError:
        raise ApiError("min_wage must be a whole number", 422)
    return jsonify(DL.open_jobs(get_db(), g.user, a.get("district") or None, min_wage, a.get("sort", "newest")))


@bp.get("/jobs/mine")
@login_required("driver")
def my_jobs():
    return jsonify(DL.my_jobs(get_db(), g.user))


@bp.post("/jobs/<jpid>/apply")
@login_required("driver")
def apply_job(jpid):
    d = json_body()
    DL.apply(get_db(), jpid, g.user, field(d, "proposed_wage_rwf", "int", min=0, max=10000000),
             field(d, "message", required=False, maxlen=300))
    return jsonify({"ok": True}), 201


@bp.post("/jobs/<jpid>/select")
@login_required()
def select_driver(jpid):
    d = json_body()
    DL.select(get_db(), jpid, g.user, field(d, "application_id", "int"))
    return jsonify({"ok": True})


@bp.post("/jobs/<jpid>/accept")
@login_required("driver")
def accept_job(jpid):
    DL.accept(get_db(), jpid, g.user)
    return jsonify({"ok": True})


@bp.post("/jobs/<jpid>/decline")
@login_required("driver")
def decline_job(jpid):
    DL.decline(get_db(), jpid, g.user)
    return jsonify({"ok": True})


@bp.post("/jobs/<jpid>/cancel")
@login_required()
def cancel_job(jpid):
    DL.cancel_job(get_db(), jpid, g.user)
    return jsonify({"ok": True})
