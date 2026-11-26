"""Dispute endpoints."""
from flask import Blueprint, g, jsonify

from ..common import field, json_body
from ..database import get_db
from ..security import login_required
from ..services import disputes as D

bp = Blueprint("disputes", __name__, url_prefix="/api")


def _detail(db, pid):
    d, tx, rel = D.require_dispute(db, pid, g.user)
    return jsonify(D.detail(db, d, tx, rel, g.user))


@bp.get("/disputes")
@login_required()
def list_disputes():
    return jsonify(D.list_for_user(get_db(), g.user))


@bp.get("/disputes/<pid>")
@login_required()
def get_dispute(pid):
    return _detail(get_db(), pid)


@bp.post("/disputes/<pid>/events")
@login_required()
def add_event(pid):
    db, body = get_db(), json_body()
    d, tx, rel = D.require_dispute(db, pid, g.user)
    D.add_event(db, d, tx, rel, g.user, field(body, "event_type", choices=("COMMENT", "PROPOSAL", "EVIDENCE")),
                field(body, "body", required=False, maxlen=1000), field(body, "evidence_id", required=False))
    return _detail(db, pid)


@bp.post("/disputes/<pid>/proposals/<int:event_id>/respond")
@login_required()
def respond(pid, event_id):
    db, body = get_db(), json_body()
    d, tx, _ = D.require_dispute(db, pid, g.user, party_only=True)
    D.respond(db, d, tx, g.user, event_id, field(body, "accept", "bool"))
    return _detail(db, pid)


@bp.post("/disputes/<pid>/resolve")
@login_required()
def resolve(pid):
    db, body = get_db(), json_body()
    d, tx, rel = D.require_dispute(db, pid, g.user)
    D.resolve(db, d, tx, rel, g.user, field(body, "outcome", required=False, maxlen=1000))
    return _detail(db, pid)


@bp.post("/disputes/<pid>/withdraw")
@login_required()
def withdraw(pid):
    db = get_db()
    d, tx, _ = D.require_dispute(db, pid, g.user, party_only=True)
    D.withdraw(db, d, tx, g.user)
    return _detail(db, pid)
