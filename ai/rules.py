"""Rule-based checks. These work offline with no AI and form the transparent baseline (concept document section 10)."""
import json
from datetime import timedelta

from ..common import now, parse_iso


def build_facts(db, tx):
    """Facts for rules and for Gemini. Deliberately contains no names or phone numbers."""
    role_of = {tx["seller_id"]: "seller", tx["buyer_id"]: "buyer"}
    ev = [{"id": e["public_id"], "category": e["category"], "by": role_of.get(e["submitted_by"], "driver"),
           "sha256": e["sha256"], "captured_at": e["captured_at"], "uploaded_at": e["created_at"]}
          for e in db.execute("SELECT * FROM evidence WHERE transaction_id=? ORDER BY id", (tx["id"],))]
    qc = [{"stage": q["stage"], "reading_sg": q["reading_sg"], "temperature_c": q["temperature_c"], "result": q["result"],
           "waived_by_buyer": bool(q["waived_at"]), "evidence": q["evidence_id"]}
          for q in db.execute("SELECT * FROM quality_checks WHERE transaction_id=? ORDER BY id", (tx["id"],))]
    pay = [{"purpose": p["purpose"], "status": p["status"], "amount_due_rwf": p["amount_due_rwf"],
            "amount_reported_rwf": p["amount_reported_rwf"], "has_proof": p["proof_evidence_id"] is not None,
            "reported_at": p["reported_at"]}
           for p in db.execute("SELECT * FROM payments WHERE transaction_id=?", (tx["id"],))]
    dis = [{"category": d["category"], "status": d["status"], "description": (d["description"] or "")[:500],
            "final_outcome": (d["final_outcome"] or "")[:500]}
           for d in db.execute("SELECT * FROM disputes WHERE transaction_id=?", (tx["id"],))]
    ai = []
    for a in db.execute("SELECT * FROM ai_analyses WHERE transaction_id=? AND kind='IMAGE_EXTRACTION'", (tx["id"],)):
        ai.append({"status": a["status"], "evidence": a["evidence_id"],
                   "confirmed": json.loads(a["confirmed_json"]) if a["confirmed_json"] else None})
    return {"status": tx["status"], "payment_status": tx["payment_status"], "litres_ordered": tx["litres"],
            "litres_accepted": tx["accepted_litres"], "price_per_litre_rwf": tx["price_per_litre"],
            "total_value_rwf": tx["total_value"], "delivery_at": tx["delivery_at"],
            "agreed_quality_range": {"min_lactometer": tx["min_lactometer"], "max_lactometer": tx["max_lactometer"],
                                     "max_temperature_c": tx["max_temperature_c"]},
            "terms_text": (tx["terms"] or "")[:500],
            "seller_accepted_at": tx["seller_accepted_at"], "buyer_accepted_at": tx["buyer_accepted_at"],
            "evidence": ev, "quality_checks": qc, "payments": pay, "disputes": dis, "ai_extractions": ai,
            "updated_at": tx["updated_at"]}


def check(facts, evidence_ids=None):
    """Return a list of {severity, code, message}. 'warning' = needs a human look; 'info' = good to know."""
    out = []
    add = lambda sev, code, msg: out.append({"severity": sev, "code": code, "message": msg})
    st = facts["status"]
    ev = facts["evidence"]
    cats = [e["category"] for e in ev]
    qr = facts["agreed_quality_range"]
    if all(v is None for v in qr.values()):
        add("info", "NO_QUALITY_RANGE", "No quality range was written into the deal, so the app cannot compare readings with an agreement.")
    if st in ("IN_TRANSIT", "DELIVERED", "ACCEPTED", "COMPLETED", "DISPUTED") and "lactometer_photo" not in cats:
        add("warning", "NO_LACTOMETER_PHOTO", "No lactometer photo is stored for this deal.")
    if st in ("DELIVERED", "ACCEPTED", "COMPLETED") and not any(q["stage"] == "ARRIVAL" for q in facts["quality_checks"]):
        add("warning", "NO_ARRIVAL_CHECK", "There is no arrival check by the buyer.")
    for q in facts["quality_checks"]:
        if q["result"] == "OUTSIDE_AGREED_RANGE":
            add("warning", "READING_OUTSIDE_RANGE",
                f"A {q['stage'].lower()} reading ({q['reading_sg']}) was outside the agreed range"
                + (" and the buyer chose to continue." if q["waived_by_buyer"] else "."))
    if facts["litres_accepted"] is not None and abs(facts["litres_accepted"] - facts["litres_ordered"]) > 1e-9:
        add("warning", "LITRES_DIFFER",
            f"The buyer accepted {facts['litres_accepted']:g} L but {facts['litres_ordered']:g} L were agreed.")
    for p in facts["payments"]:
        if p["status"] in ("REPORTED", "CONFIRMED") and p["amount_reported_rwf"] is not None \
                and p["amount_reported_rwf"] != p["amount_due_rwf"]:
            add("warning", "PAYMENT_AMOUNT_DIFFERS",
                f"{p['purpose'].title()} payment reported {p['amount_reported_rwf']} RWF but {p['amount_due_rwf']} RWF is due.")
        if p["status"] in ("REPORTED", "CONFIRMED") and not p["has_proof"]:
            add("info", "PAYMENT_NO_PROOF", f"The {p['purpose'].lower()} payment has no proof file attached (a screenshot is not proof anyway).")
        if p["status"] == "REPORTED" and p["reported_at"] and parse_iso(p["reported_at"]) < now() - timedelta(hours=48):
            add("warning", "PAYMENT_UNCONFIRMED_LONG", f"The {p['purpose'].lower()} payment was reported more than 48 hours ago and is still unconfirmed.")
    by = {e["by"] for e in ev}
    if ev and st not in ("REQUESTED", "AGREED") and not {"seller", "buyer"} <= by:
        add("info", "ONE_SIDED_EVIDENCE", "Only one party has submitted evidence so far. Independent evidence from both sides helps in a dispute.")
    seen = {}
    for e in ev:
        seen.setdefault(e["sha256"], []).append(e)
    for items in seen.values():
        if len(items) > 1:
            add("warning", "DUPLICATE_FILE", "The same file was uploaded more than once: " + ", ".join(i["id"] for i in items) + ".")
    for e in ev:
        if e["captured_at"]:
            try:
                gap = abs(parse_iso(e["uploaded_at"]) - parse_iso(e["captured_at"]))
                if gap > timedelta(hours=24):
                    add("warning", "CAPTURE_TIME_GAP", f"Evidence {e['id']} says it was captured {int(gap.total_seconds() // 3600)} hours away from when it was uploaded.")
            except Exception:
                pass
    q_by_ev = {q["evidence"]: q for q in facts["quality_checks"]}
    for a in facts["ai_extractions"]:
        if a["status"] == "SUGGESTED":
            add("info", "AI_UNCONFIRMED", "An AI suggestion has not been confirmed or rejected by a person yet.")
        c = a["confirmed"] or {}
        q = q_by_ev.get(a["evidence"])
        if q and c.get("reading_sg") is not None and q["reading_sg"] is not None and abs(float(c["reading_sg"]) - q["reading_sg"]) > 0.0005:
            add("warning", "READING_MISMATCH", f"A confirmed AI reading ({c['reading_sg']}) differs from the reading typed by the tester ({q['reading_sg']}).")
    if any(d["status"] == "OPEN" for d in facts["disputes"]):
        add("info", "DISPUTE_OPEN", "A dispute is open. Both parties' evidence is visible to each other on this deal.")
    return out
