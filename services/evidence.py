"""Evidence upload and access."""
from flask import current_app

from .. import audit
from ..common import ApiError, iso, new_public_id, field
from . import storage
from . import transactions as T

CATEGORIES = ("quality_measurement", "lactometer_photo", "delivery_photo", "collection_receipt",
              "payment_receipt", "other_document")
DRIVER_CATEGORIES = ("lactometer_photo", "delivery_photo", "other_document")


def upload(db, tx, rel, user, form, file):
    if tx["status"] in T.TERMINAL:
        raise ApiError("This deal is closed; evidence can no longer be added", 409)
    if not (rel["party"] or rel["driver"]):
        raise ApiError("Only the people in this deal can add evidence", 403)
    category = field(form, "category", choices=CATEGORIES)
    if rel["driver"] and not rel["party"] and category not in DRIVER_CATEGORIES:
        raise ApiError("Drivers can upload lactometer photos, delivery photos or other documents", 403)
    if file is None:
        raise ApiError("Choose or capture a file", 422)
    data = file.read(current_app.config["MAX_UPLOAD_BYTES"] + 1)
    cfg = current_app.config
    saved = storage.save_evidence_file(cfg["EVIDENCE_DIR"], tx["public_id"], data, cfg["MAX_UPLOAD_BYTES"])
    note = field(form, "note", required=False, maxlen=500)
    captured = field(form, "captured_at", "datetime", required=False)
    lat = field(form, "latitude", "float", required=False, min=-90, max=90)
    lon = field(form, "longitude", "float", required=False, min=-180, max=180)
    pid = new_public_id("EV")
    name = (file.filename or "upload")[:120]
    db.execute("INSERT INTO evidence (public_id, transaction_id, submitted_by, category, stored_filename, original_filename, "
               "mime_type, size_bytes, sha256, captured_at, latitude, longitude, note, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
               (pid, tx["id"], user["id"], category, saved["stored_filename"], name, saved["mime_type"], saved["size_bytes"],
                saved["sha256"], captured, lat, lon, note, iso()))
    audit.log(db, "EVIDENCE_ADDED", user["id"], tx["id"], {"evidence": pid, "category": category, "sha256": saved["sha256"]})
    return pid
