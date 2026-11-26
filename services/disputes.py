"""Structured dispute process with an immutable, timestamped event history."""
from .. import audit
from ..common import ApiError, iso, new_public_id
from . import transactions as T
from .notifier import notify


def get_dispute(db, pid):
    d = db.execute("SELECT * FROM disputes WHERE public_id=?", (pid,)).fetchone()
    if not d:
        raise ApiError("Dispute not found", 404)
    return d


def require_dispute(db, pid, user, party_only=False):
    d = get_dispute(db, pid)
    tx = db.execute("SELECT * FROM transactions WHERE id=?", (d["transaction_id"],)).fetchone()
    rel = T.relation(db, tx, user)
    if not rel["any"] or (party_only and not rel["party"]):
        raise ApiError("Dispute not found", 404)
    return d, tx, rel


def _event(db, dispute_id, actor_id, etype, body=None, evidence_id=None, ref=None):
    cur = db.execute("INSERT INTO dispute_events (dispute_id, actor_id, event_type, body, evidence_id, ref_event_id, created_at) "
                     "VALUES (?,?,?,?,?,?,?)", (dispute_id, actor_id, etype, body, evidence_id, ref, iso()))
    return cur.lastrowid


def open_dispute(db, tx, user, category, description):
    if user["id"] not in (tx["seller_id"], tx["buyer_id"]):
        raise ApiError("Only the seller or buyer can open a dispute", 403)
    if tx["status"] not in T.DISPUTABLE:
        raise ApiError("A dispute cannot be opened at this stage of the deal", 409)
    if db.execute("SELECT 1 FROM disputes WHERE transaction_id=? AND status='OPEN'", (tx["id"],)).fetchone():
        raise ApiError("There is already an open dispute for this deal", 409)
    pid = new_public_id("D")
    cur = db.execute("INSERT INTO disputes (public_id, transaction_id, opened_by, category, description, created_at) "
                     "VALUES (?,?,?,?,?,?)", (pid, tx["id"], user["id"], category, description, iso()))
    _event(db, cur.lastrowid, user["id"], "OPENED", description)
    T.touch(db, tx["id"], status="DISPUTED", status_before_dispute=tx["status"])
    audit.log(db, "DISPUTE_OPENED", user["id"], tx["id"], {"dispute": pid, "category": category})
    notify(db, T.other_party(tx, user["id"]), f"A dispute ({category}) was opened on deal {tx['public_id']}.", f"#/dispute/{pid}")
    return pid


def _restore(db, tx):
    prev = tx["status_before_dispute"] or "AGREED"
    T.touch(db, tx["id"], status=prev, status_before_dispute=None)
    db.execute("UPDATE payments SET status='REQUESTED', rejected_at=NULL, rejection_reason=NULL "
               "WHERE transaction_id=? AND status='REJECTED'", (tx["id"],))
    from .payments import refresh_status
    refresh_status(db, tx["id"])


def add_event(db, d, tx, rel, user, etype, body, evidence_pid):
    if d["status"] != "OPEN":
        raise ApiError("This dispute is closed", 409)
    mediator = (rel["coop"] or rel["admin"]) and not rel["party"]
    if mediator and etype != "COMMENT":
        raise ApiError("Observers can only add comments", 403)
    if not (rel["party"] or mediator):
        raise ApiError("You cannot take part in this dispute", 403)
    ev_id = None
    if etype == "EVIDENCE":
        ev = db.execute("SELECT id FROM evidence WHERE public_id=? AND transaction_id=?", (evidence_pid, tx["id"])).fetchone()
        if not ev:
            raise ApiError("Evidence not found on this deal. Upload it to the deal first.", 404)
        ev_id = ev["id"]
    if etype in ("COMMENT", "PROPOSAL") and not body:
        raise ApiError("Please write your message", 422)
    eid = _event(db, d["id"], user["id"], etype, body, ev_id)
    audit.log(db, f"DISPUTE_{etype}", user["id"], tx["id"], {"dispute": d["public_id"]})
    if etype != "COMMENT" or rel["party"]:
        notify(db, T.other_party(tx, user["id"]), f"New {etype.lower()} in dispute {d['public_id']}.", f"#/dispute/{d['public_id']}")
    return eid


def respond(db, d, tx, user, event_id, accept):
    if d["status"] != "OPEN":
        raise ApiError("This dispute is closed", 409)
    ev = db.execute("SELECT * FROM dispute_events WHERE id=? AND dispute_id=? AND event_type='PROPOSAL'", (event_id, d["id"])).fetchone()
    if not ev:
        raise ApiError("Proposal not found", 404)
    if ev["actor_id"] == user["id"] or user["id"] not in (tx["seller_id"], tx["buyer_id"]):
        raise ApiError("Only the other party can respond to a proposal", 403)
    if db.execute("SELECT 1 FROM dispute_events WHERE ref_event_id=?", (event_id,)).fetchone():
        raise ApiError("This proposal was already answered", 409)
    _event(db, d["id"], user["id"], "PROPOSAL_ACCEPTED" if accept else "PROPOSAL_REJECTED", None, None, event_id)
    audit.log(db, "DISPUTE_PROPOSAL_" + ("ACCEPTED" if accept else "REJECTED"), user["id"], tx["id"], {"dispute": d["public_id"]})
    notify(db, ev["actor_id"], f"Your proposal was {'accepted' if accept else 'rejected'}.", f"#/dispute/{d['public_id']}")


def resolve(db, d, tx, rel, user, outcome):
    if d["status"] != "OPEN":
        raise ApiError("This dispute is closed", 409)
    agreed = db.execute(
        "SELECT p.body FROM dispute_events a JOIN dispute_events p ON p.id=a.ref_event_id "
        "WHERE a.dispute_id=? AND a.event_type='PROPOSAL_ACCEPTED' ORDER BY a.id DESC LIMIT 1", (d["id"],)).fetchone()
    if rel["admin"]:
        pass
    elif rel["party"]:
        if not agreed:
            raise ApiError("A final outcome needs a proposal that the other party has accepted", 409)
    else:
        raise ApiError("You cannot resolve this dispute", 403)
    outcome = outcome or (agreed["body"] if agreed else None)
    if not outcome:
        raise ApiError("Write the final outcome", 422)
    db.execute("UPDATE disputes SET status='RESOLVED', final_outcome=?, resolved_by=?, resolved_at=? WHERE id=?",
               (outcome, user["id"], iso(), d["id"]))
    _event(db, d["id"], user["id"], "RESOLVED", outcome)
    _restore(db, tx)
    audit.log(db, "DISPUTE_RESOLVED", user["id"], tx["id"], {"dispute": d["public_id"], "by_admin": bool(rel["admin"] and not rel["party"])})
    for uid in (tx["seller_id"], tx["buyer_id"]):
        if uid != user["id"]:
            notify(db, uid, f"Dispute {d['public_id']} was resolved.", f"#/dispute/{d['public_id']}")


def withdraw(db, d, tx, user):
    if d["opened_by"] != user["id"] or d["status"] != "OPEN":
        raise ApiError("Only the person who opened an open dispute can withdraw it", 409)
    db.execute("UPDATE disputes SET status='WITHDRAWN', resolved_at=? WHERE id=?", (iso(), d["id"]))
    _event(db, d["id"], user["id"], "WITHDRAWN")
    _restore(db, tx)
    audit.log(db, "DISPUTE_WITHDRAWN", user["id"], tx["id"], {"dispute": d["public_id"]})
    notify(db, T.other_party(tx, user["id"]), f"Dispute {d['public_id']} was withdrawn.", f"#/dispute/{d['public_id']}")


def detail(db, d, tx, rel, user):
    events = []
    for e in db.execute("SELECT e.*, u.full_name, u.role, ev.public_id AS evp, r.event_type AS ref_type "
                        "FROM dispute_events e JOIN users u ON u.id=e.actor_id "
                        "LEFT JOIN evidence ev ON ev.id=e.evidence_id LEFT JOIN dispute_events r ON r.id=e.ref_event_id "
                        "WHERE e.dispute_id=? ORDER BY e.id", (d["id"],)):
        answered = None
        if e["event_type"] == "PROPOSAL":
            a = db.execute("SELECT event_type FROM dispute_events WHERE ref_event_id=?", (e["id"],)).fetchone()
            answered = a["event_type"] if a else None
        events.append({"event_id": e["id"], "type": e["event_type"], "actor": e["full_name"], "actor_role": e["role"],
                       "by_me": e["actor_id"] == user["id"], "body": e["body"], "evidence_id": e["evp"],
                       "ref_event_id": e["ref_event_id"], "answer": answered, "at": e["created_at"]})
    opener = db.execute("SELECT full_name FROM users WHERE id=?", (d["opened_by"],)).fetchone()
    actions = []
    if d["status"] == "OPEN":
        if rel["party"] or rel["coop"] or rel["admin"]:
            actions.append("comment")
        if rel["party"]:
            actions += ["propose", "attach_evidence", "resolve"]
        if d["opened_by"] == user["id"]:
            actions.append("withdraw")
        if rel["admin"]:
            actions.append("resolve")
    return {"id": d["public_id"], "transaction_id": tx["public_id"], "category": d["category"], "status": d["status"],
            "description": d["description"], "opened_by": opener["full_name"], "opened_by_me": d["opened_by"] == user["id"],
            "final_outcome": d["final_outcome"], "created_at": d["created_at"], "resolved_at": d["resolved_at"],
            "events": events, "evidence": T.evidence_list(db, tx["id"]), "actions": sorted(set(actions)),
            "transaction_status": tx["status"]}


def list_for_user(db, user):
    role = user["role"]
    if role == "admin":
        where, args = "1=1", []
    elif role == "coop_admin" and user["cooperative_id"]:
        where = ("(t.seller_id=? OR t.buyer_id=? OR t.seller_id IN (SELECT id FROM users WHERE cooperative_id=?) "
                 "OR t.buyer_id IN (SELECT id FROM users WHERE cooperative_id=?))")
        args = [user["id"], user["id"], user["cooperative_id"], user["cooperative_id"]]
    else:
        where, args = "(t.seller_id=? OR t.buyer_id=?)", [user["id"], user["id"]]
    return [{"id": r["public_id"], "transaction_id": r["tx"], "category": r["category"], "status": r["status"],
             "description": r["description"], "created_at": r["created_at"], "opened_by": r["opener"]}
            for r in db.execute(
                "SELECT d.*, t.public_id AS tx, u.full_name AS opener FROM disputes d JOIN transactions t ON t.id=d.transaction_id "
                "JOIN users u ON u.id=d.opened_by WHERE " + where + " ORDER BY d.id DESC LIMIT 200", args)]
