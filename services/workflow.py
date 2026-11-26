"""Delivery workflow steps: quality checks, arrival, buyer decision."""
from .. import audit
from ..common import ApiError, iso, new_public_id
from . import disputes as D
from . import payments as P
from . import quality as Q
from . import transactions as T
from .notifier import notify


def _evidence_for(db, tx, user, evidence_pid):
    ev = db.execute("SELECT * FROM evidence WHERE public_id=? AND transaction_id=?", (evidence_pid, tx["id"])).fetchone()
    if not ev or ev["category"] != "lactometer_photo" or ev["submitted_by"] != user["id"]:
        raise ApiError("Attach a lactometer photo that you uploaded to this deal", 422)
    return ev


def record_quality(db, tx, rel, user, stage, evidence_pid, reading_sg, temperature_c, tested_at, photo_legible, tester_name):
    job = T.get_job(db, tx["id"])
    transport_ready = tx["transport_mode"] == "SELF" or (job is not None and job["status"] == "ACCEPTED")
    if stage == "PICKUP":
        if tx["status"] != "AGREED":
            raise ApiError("The pickup check is recorded while the deal is agreed and waiting for pickup", 409)
        if not transport_ready:
            raise ApiError("Arrange transport first: hire a driver (and wait for acceptance) or choose self-transport", 409)
        if not (rel["seller"] or rel["carrier"]):
            raise ApiError("Only the seller or the carrier records the pickup check", 403)
        if rel["driver"] and job["stage"] != "AT_FARMER":
            raise ApiError("Mark that you arrived at the farm first", 409)
    else:
        if tx["status"] != "DELIVERED":
            raise ApiError("The arrival check is recorded after the milk is marked as arrived", 409)
        if not (rel["buyer"] or rel["carrier"]):
            raise ApiError("Only the buyer or the carrier records the arrival check", 403)
    ev = _evidence_for(db, tx, user, evidence_pid)
    result, detail = Q.evaluate(reading_sg, temperature_c, photo_legible, tx)
    pid = new_public_id("QC")
    db.execute("INSERT INTO quality_checks (public_id, transaction_id, stage, recorded_by, evidence_id, tester_name, reading_sg, "
               "temperature_c, tested_at, photo_legible, result, result_detail, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
               (pid, tx["id"], stage, user["id"], ev["id"], tester_name, reading_sg, temperature_c, tested_at,
                1 if photo_legible else 0, result, detail, iso()))
    audit.log(db, "QUALITY_RECORDED", user["id"], tx["id"], {"check": pid, "stage": stage, "result": result, "reading_sg": reading_sg})
    new_status = tx["status"]
    if stage == "PICKUP" and result in T.PASSED:
        _release(db, tx, job)
        new_status = "IN_TRANSIT"
    elif stage == "PICKUP" and result == "OUTSIDE_AGREED_RANGE":
        notify(db, tx["buyer_id"], f"Pickup reading is outside the agreed range on deal {tx['public_id']}. Your decision is needed.",
               f"#/transaction/{tx['public_id']}")
    return {"id": pid, "result": result, "result_detail": detail, "transaction_status": new_status}


def _release(db, tx, job):
    T.touch(db, tx["id"], status="IN_TRANSIT")
    if job:
        db.execute("UPDATE delivery_jobs SET stage='IN_TRANSIT' WHERE id=?", (job["id"],))
    audit.log(db, "DELIVERY_RELEASED", None, tx["id"], {"basis": "pickup check inside agreed range or waived by buyer"})
    notify(db, tx["buyer_id"], f"Milk for deal {tx['public_id']} is on its way.", f"#/transaction/{tx['public_id']}")


def waive(db, tx, rel, user, note):
    if not rel["buyer"] or tx["status"] != "AGREED":
        raise ApiError("Only the buyer can accept an out-of-range pickup reading, before pickup", 403)
    q = db.execute("SELECT * FROM quality_checks WHERE transaction_id=? AND stage='PICKUP' ORDER BY id DESC LIMIT 1", (tx["id"],)).fetchone()
    if not q or q["result"] != "OUTSIDE_AGREED_RANGE" or q["waived_at"]:
        raise ApiError("There is no out-of-range pickup check waiting for your decision", 409)
    db.execute("UPDATE quality_checks SET waived_by=?, waived_at=?, waiver_note=? WHERE id=?", (user["id"], iso(), note, q["id"]))
    audit.log(db, "QUALITY_WAIVED_BY_BUYER", user["id"], tx["id"], {"check": q["public_id"], "note": note})
    _release(db, tx, T.get_job(db, tx["id"]))


def mark_arrived(db, tx, rel, user):
    if tx["status"] != "IN_TRANSIT" or not rel["carrier"]:
        raise ApiError("Only the carrier can mark arrival while the milk is in transit", 409)
    T.touch(db, tx["id"], status="DELIVERED")
    job = T.get_job(db, tx["id"])
    if job:
        db.execute("UPDATE delivery_jobs SET stage='ARRIVED' WHERE id=?", (job["id"],))
    audit.log(db, "DELIVERY_ARRIVED", user["id"], tx["id"], {})
    notify(db, tx["buyer_id"], f"Milk arrived for deal {tx['public_id']}. Please check it and decide.", f"#/transaction/{tx['public_id']}")


def decide(db, tx, rel, user, decision, accepted_litres, reason, category):
    if not rel["buyer"] or tx["status"] != "DELIVERED":
        raise ApiError("Only the buyer can decide, after the milk has arrived", 409)
    has_check = db.execute("SELECT 1 FROM quality_checks WHERE transaction_id=? AND stage='ARRIVAL'", (tx["id"],)).fetchone()
    if not has_check:
        raise ApiError("Record your arrival check (lactometer photo and reading) before deciding", 409)
    if decision == "reject":
        if not reason or len(reason) < 5:
            raise ApiError("Explain why you reject the milk", 422)
        pid = D.open_dispute(db, tx, user, category, reason)
        audit.log(db, "BUYER_REJECTED_DELIVERY", user["id"], tx["id"], {"dispute": pid})
        return {"dispute_id": pid}
    litres = accepted_litres if accepted_litres is not None else tx["litres"]
    if litres <= 0 or litres > tx["litres"] + 1e-9:
        raise ApiError(f"Accepted litres must be between 0 and {tx['litres']:g}", 422)
    T.touch(db, tx["id"], status="ACCEPTED", accepted_litres=round(litres, 2))
    job = T.get_job(db, tx["id"])
    if job:
        db.execute("UPDATE delivery_jobs SET status='COMPLETED' WHERE id=?", (job["id"],))
    tx = db.execute("SELECT * FROM transactions WHERE id=?", (tx["id"],)).fetchone()
    P.create_for_acceptance(db, tx, litres)
    audit.log(db, "BUYER_ACCEPTED_DELIVERY", user["id"], tx["id"], {"accepted_litres": round(litres, 2), "ordered_litres": tx["litres"]})
    notify(db, tx["seller_id"], f"The buyer accepted {litres:g} L on deal {tx['public_id']}. Payment tracking has started.",
           f"#/transaction/{tx['public_id']}")
    return {"accepted_litres": round(litres, 2)}
