"""Regenerates database/sample_data.sql.  All people and numbers are FICTIONAL.   python scripts/make_sample_data.py"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from werkzeug.security import generate_password_hash  # noqa: E402

PW = "Demo1234!"
H = generate_password_hash(PW)
NOW = "2026-11-20T08:00:00Z"
users = [  # public_id, name, phone, role, business, district, sector, lat, lon, coop, vehicle, verified
    ("U-DEMO0001", "System Admin (demo)", "+250788000001", "admin", None, "Nyarugenge", None, None, None, None, None, 1),
    ("U-DEMO0002", "Alice Mukamana (demo)", "+250788000002", "farmer", "Mukamana Dairy Farm", "Nyabihu", "Mukamira", -1.6500, 29.5000, 1, None, 1),
    ("U-DEMO0003", "Jean Bosco Habimana (demo)", "+250788000003", "farmer", None, "Nyabihu", "Rambura", -1.6900, 29.4500, 1, None, 0),
    ("U-DEMO0004", "Kabeza Dairy Ltd (demo)", "+250788000004", "buyer", "Kabeza Dairy", "Gasabo", "Kimironko", -1.9500, 30.1100, None, None, 1),
    ("U-DEMO0005", "Eric Niyonsenga (demo)", "+250788000005", "buyer", "Niyonsenga Milk Bar", "Musanze", "Muhoza", -1.4990, 29.6340, None, None, 0),
    ("U-DEMO0006", "Patrick Uwimana (demo)", "+250788000006", "driver", None, "Nyabihu", "Mukamira", None, None, None, "motorcycle", 1),
    ("U-DEMO0007", "Claudine Ingabire (demo)", "+250788000007", "driver", None, "Musanze", "Muhoza", None, None, None, "bicycle", 0),
    ("U-DEMO0008", "Marie Uwase (demo)", "+250788000008", "collector", "Uwase Collection", "Rubavu", "Gisenyi", -1.7020, 29.2570, None, None, 0),
    ("U-DEMO0009", "Nyabihu Dairy Cooperative Admin (demo)", "+250788000009", "coop_admin", "Nyabihu Dairy Cooperative (demo)", "Nyabihu", None, None, None, 1, None, 1),
]
q = lambda v: "NULL" if v is None else (str(v) if isinstance(v, (int, float)) else "'" + v.replace("'", "''") + "'")
out = ["-- AmataShield SAMPLE DATA. Every person, phone number and business below is FICTIONAL.",
       f"-- Demo password for all users: {PW}", "PRAGMA foreign_keys = ON;", "BEGIN;",
       f"INSERT INTO cooperatives (id, name, district, created_at) VALUES (1, 'Nyabihu Dairy Cooperative (demo)', 'Nyabihu', '{NOW}');"]
for i, u in enumerate(users, 1):
    out.append("INSERT INTO users (id, public_id, full_name, phone, password_hash, role, business_name, district, sector, latitude, longitude, "
               "cooperative_id, vehicle_type, is_verified, consent_at, created_at, updated_at) VALUES "
               f"({i}, {q(u[0])}, {q(u[1])}, {q(u[2])}, {q(H)}, {q(u[3])}, {q(u[4])}, {q(u[5])}, {q(u[6])}, {q(u[7])}, {q(u[8])}, {q(u[9])}, {q(u[10])}, {u[11]}, '{NOW}', '{NOW}', '{NOW}');")
methods = [(2, "momo_code", "Alice MoMo Pay", "100200"), (3, "momo_phone", "Jean Bosco MoMo", "0788000003"), (6, "momo_phone", "Patrick MoMo", "0788000006"), (8, "bank", "Uwase e-banking", "ACC-DEMO-0008")]
for uid, t, label, val in methods:
    out.append(f"INSERT INTO payment_methods (user_id, method_type, label, account_value, created_at) VALUES ({uid}, '{t}', {q(label)}, {q(val)}, '{NOW}');")
listings = [  # id, public, type, owner, litres, price, location, district, lat, lon, minL, maxL, maxT, terms, max_transit_minutes
    (1, "L-DEMO0001", "SELL", 2, 120, 350, "Mukamira collection point", "Nyabihu", -1.6500, 29.5000, 1.026, 1.034, 25, "Morning pickup before 8am. Bring clean cans.", 180),
    (2, "L-DEMO0002", "SELL", 3, 60, 330, "Rambura trading centre", "Nyabihu", -1.6900, 29.4500, 1.026, 1.034, None, "Evening milk, pickup 5-6pm.", 120),
    (3, "L-DEMO0003", "SELL", 8, 400, 340, "Gisenyi aggregation point", "Rubavu", -1.7020, 29.2570, 1.027, 1.033, 20, "Aggregated from 18 small farmers.", 240),
    (4, "L-DEMO0004", "BUY", 4, 300, 360, "Kimironko plant gate", "Gasabo", -1.9500, 30.1100, 1.028, 1.034, 22, "Need steady weekly supply.", None),
]
for l in listings:
    out.append("INSERT INTO listings (id, public_id, listing_type, owner_id, litres_total, litres_remaining, price_per_litre, location_name, district, latitude, longitude, "
               "available_from, available_until, min_lactometer, max_lactometer, max_temperature_c, terms, created_at, max_transit_minutes) VALUES "
               f"({l[0]}, {q(l[1])}, {q(l[2])}, {l[3]}, {l[4]}, {l[4]}, {l[5]}, {q(l[6])}, {q(l[7])}, {q(l[8])}, {q(l[9])}, '2026-11-21T05:00:00Z', '2027-12-31T23:59:59Z', {q(l[10])}, {q(l[11])}, {q(l[12])}, {q(l[13])}, '{NOW}', {q(l[14])});")
out.append("COMMIT;")
(ROOT / "database" / "sample_data.sql").write_text("\n".join(out) + "\n", encoding="utf-8")
print("wrote database/sample_data.sql")
