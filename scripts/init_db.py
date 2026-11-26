"""Create the database (safe to run again):   python scripts/init_db.py [--sample]
--sample also loads database/sample_data.sql (fictional demo users and listings)."""
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.config import load_config  # noqa: E402
from backend.database import init_db  # noqa: E402

cfg = load_config()
Path(cfg["DATA_DIR"]).mkdir(parents=True, exist_ok=True)
init_db(cfg["DATABASE_PATH"], cfg["SCHEMA_PATH"])
print("Database ready:", cfg["DATABASE_PATH"])
if "--sample" in sys.argv:
    con = sqlite3.connect(cfg["DATABASE_PATH"])
    try:
        with open(ROOT / "database" / "sample_data.sql", encoding="utf-8") as fh:
            con.executescript(fh.read())
        print("Sample data loaded. Demo password for every demo user: Demo1234!")
    except sqlite3.IntegrityError:
        print("Sample data is already loaded (skipped).")
    finally:
        con.close()
