"""Fill a FRESH database with fictional demo deals in several states (used for demos and screenshots).

    python scripts/init_db.py --sample      # users + listings
    python scripts/seed_demo.py             # deals, photos, payments, a dispute

Everything is fictional. The photos are drawn placeholders labelled DEMO IMAGE, not real lactometers.
"""
import io
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from PIL import Image, ImageDraw  # noqa: E402

from backend.app import create_app  # noqa: E402

app = create_app()
H = {"X-Requested-With": "AmataShield"}
PW = "Demo1234!"


def photo(label, seed):
    im = Image.new("RGB", (640, 480), (232, 245, 236))
    d = ImageDraw.Draw(im)
    d.rectangle([260, 40, 380, 430], outline=(11, 93, 59), width=5, fill=(255, 255, 255))
    for i in range(0, 20):
        y = 70 + i * 17
        d.line([260, y, 300 if i % 5 else 320, y], fill=(11, 31, 58), width=2)
    d.ellipse([285, 250 + seed % 40, 355, 320 + seed % 40], fill=(244, 180, 0))
    d.text((20, 20), "DEMO IMAGE - fictional", fill=(192, 57, 43))
    d.text((20, 450), label, fill=(11, 31, 58))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    buf.seek(0)
    return buf


class U:
    def __init__(self, phone):
        self.c = app.test_client()
        r = self.c.post("/api/auth/login", json={"phone": phone, "password": PW}, headers=H)
        assert r.status_code == 200, f"cannot log in {phone}: run init_db.py --sample first"

    def post(self, path, **body):
        r = self.c.post(path, json=body, headers=H)
        assert r.status_code < 300, (path, r.status_code, r.get_json())
        return r.get_json()

    def photo(self, tx, category, label, seed):
        r = self.c.post(f"/api/transactions/{tx}/evidence", headers=H, content_type="multipart/form-data",
                        data={"category": category, "file": (photo(label, seed), "demo.jpg")})
        assert r.status_code == 201, r.get_json()
        return r.get_json()["id"]


admin, alice, jean, kabeza, eric, patrick, marie = (U(p) for p in (
    "0788000001", "0788000002", "0788000003", "0788000004", "0788000005", "0788000006", "0788000008"))

# A) completed deal with a hired driver
tx = kabeza.post("/api/listings/L-DEMO0001/book", litres=40)["id"]
alice.post(f"/api/transactions/{tx}/confirm")
job = kabeza.post(f"/api/transactions/{tx}/job", wage_rwf=2000, contact_method="whatsapp")["job"]["id"]
patrick.post(f"/api/jobs/{job}/apply", proposed_wage_rwf=2000, message="Motorcycle, 6 years experience")
app_id = kabeza.c.get(f"/api/transactions/{tx}", headers=H).get_json()["job"]["applications"][0]["application_id"]
kabeza.post(f"/api/jobs/{job}/select", application_id=app_id)
patrick.post(f"/api/jobs/{job}/accept")
patrick.post(f"/api/transactions/{tx}/driver-arrived")
ev = patrick.photo(tx, "lactometer_photo", "Pickup check", 1)
patrick.post(f"/api/transactions/{tx}/quality", stage="PICKUP", evidence_id=ev, reading_sg=1.029, temperature_c=21)
patrick.post(f"/api/transactions/{tx}/arrived")
ev = kabeza.photo(tx, "lactometer_photo", "Arrival check", 2)
kabeza.post(f"/api/transactions/{tx}/quality", stage="ARRIVAL", evidence_id=ev, reading_sg=1.030)
t = kabeza.post(f"/api/transactions/{tx}/decision", decision="accept", accepted_litres=40)
pays = {p["purpose"]: p["id"] for p in t["payments"]}
proof = kabeza.photo(tx, "payment_receipt", "MoMo receipt (demo)", 3)
kabeza.post(f"/api/payments/{pays['MILK']}/report", method_type="momo_code", reference="DEMO-MP-0001", amount_rwf=14000, proof_evidence_id=proof)
alice.post(f"/api/payments/{pays['MILK']}/confirm")
kabeza.post(f"/api/payments/{pays['TRANSPORT']}/report", method_type="momo_phone", reference="DEMO-MP-0002", amount_rwf=2000)
patrick.post(f"/api/payments/{pays['TRANSPORT']}/confirm")

# B) milk in transit (self transport by the farmer)
tx = eric.post("/api/listings/L-DEMO0002/book", litres=20)["id"]
jean.post(f"/api/transactions/{tx}/confirm")
jean.post(f"/api/transactions/{tx}/transport/self")
ev = jean.photo(tx, "lactometer_photo", "Pickup check", 4)
jean.post(f"/api/transactions/{tx}/quality", stage="PICKUP", evidence_id=ev, reading_sg=1.030, temperature_c=19)

# C) rejected delivery -> dispute with a comment
tx = kabeza.post("/api/listings/L-DEMO0003/book", litres=50)["id"]
marie.post(f"/api/transactions/{tx}/confirm")
kabeza.post(f"/api/transactions/{tx}/transport/self")
ev = kabeza.photo(tx, "lactometer_photo", "Pickup check", 5)
kabeza.post(f"/api/transactions/{tx}/quality", stage="PICKUP", evidence_id=ev, reading_sg=1.030)
kabeza.post(f"/api/transactions/{tx}/arrived")
ev = kabeza.photo(tx, "lactometer_photo", "Arrival check", 6)
kabeza.post(f"/api/transactions/{tx}/quality", stage="ARRIVAL", evidence_id=ev, reading_sg=1.022)
kabeza.post(f"/api/transactions/{tx}/decision", decision="reject", category="quality", reason="Arrival reading 1.022 is below the agreed 1.027 minimum.")
did = kabeza.c.get("/api/disputes", headers=H).get_json()[0]["id"]
marie.post(f"/api/disputes/{did}/events", event_type="COMMENT", body="The cans sat in the sun at the gate for 40 minutes before your check.")

# D) a booking still waiting for the farmer to confirm (long hold only for the demo)
app.config["BOOKING_HOLD_SECONDS"] = 3600
eric.post("/api/listings/L-DEMO0001/book", litres=15)
print("Demo deals created: completed, in transit, disputed, waiting-for-confirmation.")
