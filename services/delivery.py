"""Driver jobs: post a delivery job, drivers apply, poster selects, driver accepts, driver arrives at the farm."""
from .. import audit
from ..common import ApiError, iso, new_public_id
from . import transactions as T
from .notifier import notify


def _driver_brief(db, uid, show_phone):
    u = db.execute("SELECT full_name, phone, vehicle_type, district, is_verified FROM users WHERE id=?", (uid,)).fetchone()
    d = {"full_name": u["full_name"], "vehicle_type": u["vehicle_type"], "district": u["district"],
         "is_verified": bool(u["is_verified"])}
    if show_phone:
        d["phone"] = u["phone"]
    return d


def job_dict(db, job, user, rel=None):
    uid = user["id"]
    tx = db.execute("SELECT * FROM transactions WHERE id=?", (job["transaction_id"],)).fetchone()
    poster = job["posted_by"] == uid
    is_driver = job["assigned_driver_id"] == uid
    parties = uid in (tx["seller_id"], tx["buyer_id"])
    reveal = job["status"] in ("ACCEPTED", "COMPLETED") and (parties or is_driver)
    d = {"id": job["public_id"], "status": job["status"], "stage": job["stage"], "wage_rwf": job["wage_rwf"],
         "agreed_wage_rwf": job["agreed_wage_rwf"], "contact_method": job["contact_method"],
         "vehicle_pref": job["vehicle_pref"], "dropoff_name": job["dropoff_name"], "notes": job["notes"],
         "posted_by_me": poster, "created_at": job["created_at"], "actions": [],
         "driver": _driver_brief(db, job["assigned_driver_id"], reveal) if job["assigned_driver_id"] else None}
    if parties:
        apps = []
        for a in db.execute("SELECT * FROM driver_applications WHERE job_id=? ORDER BY id", (job["id"],)):
            x = {"application_id": a["id"], "proposed_wage_rwf": a["proposed_wage_rwf"], "message": a["message"],
                 "status": a["status"], "created_at": a["created_at"], "driver": _driver_brief(db, a["driver_id"], False)}
            apps.append(x)
        d["applications"] = apps
    if poster and job["status"] == "OPEN":
        d["actions"].append("select_driver")
    if poster and job["status"] in ("OPEN", "ASSIGNED", "ACCEPTED") and tx["status"] == "AGREED":
        d["actions"].append("cancel_job")
    if is_driver and job["status"] == "ASSIGNED":
        d["actions"] += ["accept_job", "decline_job"]
    return d


def _get_job(db, pid):
    job = db.execute("SELECT * FROM delivery_jobs WHERE public_id=?", (pid,)).fetchone()
    if not job:
        raise ApiError("Job not found", 404)
    return job


def post_job(db, tx, user, wage, contact_method, vehicle_pref, dropoff_name, notes):
    if tx["status"] != "AGREED" or user["id"] not in (tx["seller_id"], tx["buyer_id"]):
        raise ApiError("Only the seller or buyer of an agreed deal can hire a driver", 409)
    if tx["transport_mode"] == "SELF":
        raise ApiError("You chose to transport the milk yourself for this deal", 409)
    if T.get_job(db, tx["id"]):
        raise ApiError("A driver job already exists for this deal", 409)
    pid = new_public_id("J")
    cur = db.execute(
        "INSERT INTO delivery_jobs (public_id, transaction_id, posted_by, wage_rwf, contact_method, vehicle_pref, "
        "dropoff_name, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (pid, tx["id"], user["id"], wage, contact_method, vehicle_pref, dropoff_name, notes, iso()))
    T.touch(db, tx["id"], transport_mode="DRIVER")
    audit.log(db, "JOB_POSTED", user["id"], tx["id"], {"job": pid, "wage_rwf": wage, "contact_method": contact_method})
    # tell drivers in the pickup district (in-app now; SMS/WhatsApp later)
    for r in db.execute("SELECT id FROM users WHERE role='driver' AND is_active=1 AND district=? LIMIT 50", (tx["district"],)):
        notify(db, r["id"], f"New delivery job in {tx['district']}: {wage} RWF", "#/jobs")
    return pid


def open_jobs(db, user, district=None, min_wage=None, sort="newest"):
    q = ("SELECT j.*, t.litres, t.location_name, t.district, t.delivery_at FROM delivery_jobs j "
         "JOIN transactions t ON t.id=j.transaction_id WHERE j.status='OPEN' AND t.status='AGREED'")
    args = []
    if district:
        q += " AND t.district=?"
        args.append(district)
    if min_wage:
        q += " AND j.wage_rwf>=?"
        args.append(min_wage)
    q += {"wage": " ORDER BY j.wage_rwf DESC", "date": " ORDER BY t.delivery_at ASC"}.get(sort, " ORDER BY j.id DESC")
    out = []
    for j in db.execute(q + " LIMIT 100", args):
        mine = db.execute("SELECT status, proposed_wage_rwf FROM driver_applications WHERE job_id=? AND driver_id=?",
                          (j["id"], user["id"])).fetchone()
        out.append({"id": j["public_id"], "litres": j["litres"], "pickup": j["location_name"], "district": j["district"],
                    "dropoff_name": j["dropoff_name"], "delivery_at": j["delivery_at"], "wage_rwf": j["wage_rwf"],
                    "vehicle_pref": j["vehicle_pref"], "notes": j["notes"], "contact_method": j["contact_method"],
                    "my_application": dict(mine) if mine else None})
    return out


def my_jobs(db, user):
    out = []
    for j in db.execute("SELECT j.*, t.public_id AS tx, t.litres, t.location_name, t.district, t.delivery_at, t.status AS tx_status "
                        "FROM delivery_jobs j JOIN transactions t ON t.id=j.transaction_id "
                        "WHERE j.assigned_driver_id=? AND j.status IN ('ASSIGNED','ACCEPTED','COMPLETED') ORDER BY j.id DESC",
                        (user["id"],)):
        out.append({"id": j["public_id"], "transaction_id": j["tx"], "status": j["status"], "stage": j["stage"],
                    "tx_status": j["tx_status"], "litres": j["litres"], "pickup": j["location_name"],
                    "district": j["district"], "delivery_at": j["delivery_at"],
                    "wage_rwf": j["agreed_wage_rwf"] or j["wage_rwf"]})
    return out


def apply(db, job_pid, user, wage, message):
    job = _get_job(db, job_pid)
    tx = db.execute("SELECT * FROM transactions WHERE id=?", (job["transaction_id"],)).fetchone()
    if job["status"] != "OPEN" or tx["status"] != "AGREED":
        raise ApiError("This job is no longer open", 409)
    if db.execute("SELECT 1 FROM driver_applications WHERE job_id=? AND driver_id=?", (job["id"], user["id"])).fetchone():
        raise ApiError("You already applied for this job", 409)
    db.execute("INSERT INTO driver_applications (job_id, driver_id, proposed_wage_rwf, message, created_at) VALUES (?,?,?,?,?)",
               (job["id"], user["id"], wage, message, iso()))
    audit.log(db, "JOB_APPLICATION", user["id"], tx["id"], {"job": job_pid, "proposed_wage_rwf": wage})
    notify(db, job["posted_by"], f"{user['full_name']} applied for your delivery job.", f"#/transaction/{tx['public_id']}")


def select(db, job_pid, user, application_id):
    job = _get_job(db, job_pid)
    tx = db.execute("SELECT * FROM transactions WHERE id=?", (job["transaction_id"],)).fetchone()
    if job["posted_by"] != user["id"]:
        raise ApiError("Only the person who posted the job can choose a driver", 403)
    if job["status"] != "OPEN" or tx["status"] != "AGREED":
        raise ApiError("This job is not open", 409)
    app = db.execute("SELECT * FROM driver_applications WHERE id=? AND job_id=? AND status='APPLIED'",
                     (application_id, job["id"])).fetchone()
    if not app:
        raise ApiError("Application not found", 404)
    db.execute("UPDATE driver_applications SET status=CASE WHEN id=? THEN 'SELECTED' ELSE 'REJECTED' END "
               "WHERE job_id=? AND status IN ('APPLIED','SELECTED')", (app["id"], job["id"]))
    db.execute("UPDATE delivery_jobs SET status='ASSIGNED', assigned_driver_id=?, agreed_wage_rwf=? WHERE id=?",
               (app["driver_id"], app["proposed_wage_rwf"], job["id"]))
    audit.log(db, "JOB_DRIVER_SELECTED", user["id"], tx["id"], {"job": job_pid, "wage_rwf": app["proposed_wage_rwf"]})
    notify(db, app["driver_id"], "You were chosen for a delivery job. Open it to accept.", "#/jobs")


def accept(db, job_pid, user):
    job = _get_job(db, job_pid)
    if job["assigned_driver_id"] != user["id"] or job["status"] != "ASSIGNED":
        raise ApiError("This job is not waiting for your acceptance", 409)
    tx = db.execute("SELECT * FROM transactions WHERE id=?", (job["transaction_id"],)).fetchone()
    if tx["status"] != "AGREED":
        raise ApiError("The deal is no longer waiting for pickup", 409)
    db.execute("UPDATE delivery_jobs SET status='ACCEPTED' WHERE id=?", (job["id"],))
    T.touch(db, tx["id"], carrier_id=user["id"])
    audit.log(db, "JOB_ACCEPTED", user["id"], tx["id"], {"job": job_pid})
    for uid in (tx["seller_id"], tx["buyer_id"]):
        notify(db, uid, f"Driver {user['full_name']} accepted the delivery job.", f"#/transaction/{tx['public_id']}")


def decline(db, job_pid, user):
    job = _get_job(db, job_pid)
    if job["assigned_driver_id"] != user["id"] or job["status"] != "ASSIGNED":
        raise ApiError("This job is not waiting for your answer", 409)
    db.execute("UPDATE driver_applications SET status='WITHDRAWN' WHERE job_id=? AND driver_id=?", (job["id"], user["id"]))
    db.execute("UPDATE delivery_jobs SET status='OPEN', assigned_driver_id=NULL, agreed_wage_rwf=NULL WHERE id=?", (job["id"],))
    tx = db.execute("SELECT * FROM transactions WHERE id=?", (job["transaction_id"],)).fetchone()
    audit.log(db, "JOB_DRIVER_DECLINED", user["id"], tx["id"], {"job": job_pid})
    notify(db, job["posted_by"], "The chosen driver declined. Choose another driver.", f"#/transaction/{tx['public_id']}")


def arrived_farmer(db, tx, user):
    job = T.get_job(db, tx["id"])
    if not job or job["assigned_driver_id"] != user["id"] or job["status"] != "ACCEPTED" or tx["status"] != "AGREED":
        raise ApiError("You cannot mark arrival for this deal now", 409)
    db.execute("UPDATE delivery_jobs SET stage='AT_FARMER' WHERE id=?", (job["id"],))
    audit.log(db, "DRIVER_AT_FARM", user["id"], tx["id"], {})
    notify(db, tx["seller_id"], "The driver has arrived at your collection point.", f"#/transaction/{tx['public_id']}")


def cancel_job(db, job_pid, user):
    job = _get_job(db, job_pid)
    tx = db.execute("SELECT * FROM transactions WHERE id=?", (job["transaction_id"],)).fetchone()
    if job["posted_by"] != user["id"]:
        raise ApiError("Only the person who posted the job can cancel it", 403)
    if job["status"] not in ("OPEN", "ASSIGNED", "ACCEPTED") or tx["status"] != "AGREED":
        raise ApiError("This job can no longer be cancelled", 409)
    db.execute("UPDATE delivery_jobs SET status='CANCELLED' WHERE id=?", (job["id"],))
    T.touch(db, tx["id"], transport_mode="UNDECIDED", carrier_id=None)
    audit.log(db, "JOB_CANCELLED", user["id"], tx["id"], {"job": job_pid})
    if job["assigned_driver_id"]:
        notify(db, job["assigned_driver_id"], "A delivery job you were chosen for was cancelled.", "#/jobs")
