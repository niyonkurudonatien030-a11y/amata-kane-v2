"""Payment TRACKING (not money movement). AmataShield records who says they paid and who confirms receipt.

Per-payment states:  REQUESTED -> REPORTED (payer says paid) -> CONFIRMED (payee confirms) or REJECTED (payee disagrees).
Deal-level payment_status: UNCONFIRMED | PAYMENT_REPORTED | CONFIRMED_BY_BOTH | DISPUTED.
A future, authorised mobile-money integration would replace the manual "report"/"confirm" steps with provider callbacks.
"""
from .. import audit
from ..common import ApiError, iso
from . import disputes as D
from . import transactions as T
from .notifier import notify

METHODS = ("momo_code", "momo_phone", "bank", "other")


def create_for_acceptance(db, tx, accepted_litres):
    amount = round(accepted_litres * tx["price_per_litre"])
    ts = iso()
    from ..common import new_public_id
    db.execute("INSERT INTO payments (public_id, transaction_id, purpose, payer_id, payee_id, amount_due_rwf, created_at) "
               "VALUES (?,?,?,?,?,?,?)", (new_public_id("P"), tx["id"], "MILK", tx["buyer_id"], tx["seller_id"], amount, ts))
    job = T.get_job(db, tx["id"])
    if job and job["assigned_driver_id"]:
        wage = job["agreed_wage_rwf"] if job["agreed_wage_rwf"] is not None else job["wage_rwf"]
        db.execute("INSERT INTO payments (public_id, transaction_id, purpose, payer_id, payee_id, amount_due_rwf, created_at) "
                   "VALUES (?,?,?,?,?,?,?)", (new_public_id("P"), tx["id"], "TRANSPORT", job["posted_by"],
                                              job["assigned_driver_id"], wage, ts))
    refresh_status(db, tx["id"])


def refresh_status(db, tx_id):
    milk = db.execute("SELECT status FROM payments WHERE transaction_id=? AND purpose='MILK'", (tx_id,)).fetchone()
    if milk:
        status = {"REQUESTED": "UNCONFIRMED", "REPORTED": "PAYMENT_REPORTED", "CONFIRMED": "CONFIRMED_BY_BOTH",
                  "REJECTED": "DISPUTED"}[milk["status"]]
        db.execute("UPDATE transactions SET payment_status=?, updated_at=? WHERE id=?", (status, iso(), tx_id))
    tx = db.execute("SELECT * FROM transactions WHERE id=?", (tx_id,)).fetchone()
    rows = db.execute("SELECT status FROM payments WHERE transaction_id=?", (tx_id,)).fetchall()
    if tx["status"] == "ACCEPTED" and rows and all(r["status"] == "CONFIRMED" for r in rows):
        T.touch(db, tx_id, status="COMPLETED")
        audit.log(db, "TX_COMPLETED", None, tx_id, {})


def _get(db, pid, user):
    p = db.execute("SELECT * FROM payments WHERE public_id=?", (pid,)).fetchone()
    if not p or user["id"] not in (p["payer_id"], p["payee_id"]):
        raise ApiError("Payment not found", 404)
    tx = db.execute("SELECT * FROM transactions WHERE id=?", (p["transaction_id"],)).fetchone()
    if tx["status"] != "ACCEPTED":
        raise ApiError("Payments can be updated only while the deal is accepted and not in dispute", 409)
    return p, tx


def report(db, pid, user, method_type, method_detail, reference, amount, proof_pid):
    p, tx = _get(db, pid, user)
    retry = p["status"] == "REJECTED" and p["purpose"] == "TRANSPORT"
    if p["payer_id"] != user["id"] or (p["status"] != "REQUESTED" and not retry):
        raise ApiError("Only the payer can report a payment that is waiting to be paid", 409)
    proof_id = None
    if proof_pid:
        ev = db.execute("SELECT id FROM evidence WHERE public_id=? AND transaction_id=? AND submitted_by=?",
                        (proof_pid, tx["id"], user["id"])).fetchone()
        if not ev:
            raise ApiError("Proof file not found. Upload it to this deal first.", 404)
        proof_id = ev["id"]
    db.execute("UPDATE payments SET status='REPORTED', method_type=?, method_detail=?, reference=?, amount_reported_rwf=?, "
               "proof_evidence_id=?, reported_at=? WHERE id=?", (method_type, method_detail, reference, amount, proof_id, iso(), p["id"]))
    refresh_status(db, tx["id"])
    audit.log(db, "PAYMENT_REPORTED", user["id"], tx["id"], {"payment": pid, "purpose": p["purpose"], "amount_rwf": amount,
                                                          "has_proof": bool(proof_id)})
    notify(db, p["payee_id"], f"{user['full_name']} says they paid {amount} RWF. Check your balance, then confirm or reject.",
           f"#/transaction/{tx['public_id']}")
    return {"amount_mismatch": amount != p["amount_due_rwf"]}


def confirm(db, pid, user):
    p, tx = _get(db, pid, user)
    if p["payee_id"] != user["id"] or p["status"] != "REPORTED":
        raise ApiError("Only the person being paid can confirm a reported payment", 409)
    db.execute("UPDATE payments SET status='CONFIRMED', confirmed_at=? WHERE id=?", (iso(), p["id"]))
    audit.log(db, "PAYMENT_CONFIRMED", user["id"], tx["id"], {"payment": pid, "purpose": p["purpose"]})
    notify(db, p["payer_id"], "Your payment was confirmed.", f"#/transaction/{tx['public_id']}")
    refresh_status(db, tx["id"])


def reject(db, pid, user, reason):
    p, tx = _get(db, pid, user)
    if p["payee_id"] != user["id"] or p["status"] != "REPORTED":
        raise ApiError("Only the person being paid can reject a reported payment", 409)
    db.execute("UPDATE payments SET status='REJECTED', rejected_at=?, rejection_reason=? WHERE id=?", (iso(), reason, p["id"]))
    refresh_status(db, tx["id"])
    audit.log(db, "PAYMENT_REJECTED", user["id"], tx["id"], {"payment": pid, "purpose": p["purpose"], "reason": reason})
    if p["purpose"] == "MILK":
        # "flag both until the conflict is settled": a rejected milk payment automatically opens a payment dispute
        tx = db.execute("SELECT * FROM transactions WHERE id=?", (tx["id"],)).fetchone()
        D.open_dispute(db, tx, user, "payment", f"Payment {pid} was rejected by the receiver: {reason}")
        notify(db, p["payer_id"], "Your payment was rejected. Both of you are flagged until the dispute is settled.",
               f"#/transaction/{tx['public_id']}")
    else:
        notify(db, p["payer_id"], f"The driver rejected the transport payment: {reason}. Settle it and report again.",
               f"#/transaction/{tx['public_id']}")
