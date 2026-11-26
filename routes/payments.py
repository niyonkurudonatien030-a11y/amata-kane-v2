"""Payment tracking endpoints (records statements; does not move money)."""
from flask import Blueprint, g, jsonify

from ..common import field, json_body
from ..database import get_db
from ..security import login_required
from ..services import payments as P
from ..services import transactions as T

bp = Blueprint("payments", __name__, url_prefix="/api")


def _tx_json(db, payment_pid):
    row = db.execute("SELECT t.* FROM transactions t JOIN payments p ON p.transaction_id=t.id WHERE p.public_id=?", (payment_pid,)).fetchone()
    return T.detail(db, row, g.user, T.relation(db, row, g.user))


@bp.post("/payments/<pid>/report")
@login_required()
def report(pid):
    db, d = get_db(), json_body()
    info = P.report(db, pid, g.user, field(d, "method_type", choices=P.METHODS), field(d, "method_detail", required=False, maxlen=120),
                    field(d, "reference", maxlen=80), field(d, "amount_rwf", "int", min=1, max=1000000000),
                    field(d, "proof_evidence_id", required=False))
    return jsonify({**info, "transaction": _tx_json(db, pid),
                    "notice": "This records your statement. AmataShield does not move or verify money."})


@bp.post("/payments/<pid>/confirm")
@login_required()
def confirm(pid):
    db = get_db()
    P.confirm(db, pid, g.user)
    return jsonify({"transaction": _tx_json(db, pid)})


@bp.post("/payments/<pid>/reject")
@login_required()
def reject(pid):
    db, d = get_db(), json_body()
    P.reject(db, pid, g.user, field(d, "reason", maxlen=300))
    return jsonify({"transaction": _tx_json(db, pid)})
