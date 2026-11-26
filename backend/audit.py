"""Tamper-evident event history (hash chain)."""
import hashlib
import json

from .common import iso

GENESIS = "0" * 64


def _hash(prev, created_at, actor_id, tx_id, action, details_json):
    payload = "|".join([prev, created_at, str(actor_id or ""), str(tx_id or ""), action, details_json])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def log(db, action, actor_id=None, transaction_id=None, details=None):
    last = db.execute("SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1").fetchone()
    prev = last["entry_hash"] if last else GENESIS
    ts = iso()
    dj = json.dumps(details or {}, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    h = _hash(prev, ts, actor_id, transaction_id, action, dj)
    db.execute(
        "INSERT INTO audit_log (transaction_id, actor_id, action, details_json, prev_hash, entry_hash, created_at) "
        "VALUES (?,?,?,?,?,?,?)", (transaction_id, actor_id, action, dj, prev, h, ts))


def verify_chain(db):
    prev, count = GENESIS, 0
    for r in db.execute("SELECT * FROM audit_log ORDER BY id"):
        expected = _hash(prev, r["created_at"], r["actor_id"], r["transaction_id"], r["action"], r["details_json"])
        if r["prev_hash"] != prev or r["entry_hash"] != expected:
            return {"ok": False, "entries_checked": count, "first_bad_entry_id": r["id"]}
        prev, count = r["entry_hash"], count + 1
    return {"ok": True, "entries_checked": count, "first_bad_entry_id": None}
