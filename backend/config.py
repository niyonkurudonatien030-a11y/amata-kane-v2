"""Configuration. Values come from environment variables (see .env.example)."""
import os
import secrets
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")


def _secret_key(data_dir: Path) -> str:
    """Use SECRET_KEY from the environment, else create and reuse a random local key file."""
    env_key = os.getenv("SECRET_KEY", "").strip()
    if env_key:
        return env_key
    data_dir.mkdir(parents=True, exist_ok=True)
    key_file = data_dir / "secret.key"
    if not key_file.exists():
        key_file.write_text(secrets.token_hex(32))
        try:
            key_file.chmod(0o600)
        except OSError:
            pass
    return key_file.read_text().strip()


def load_config(overrides=None) -> dict:
    data_dir = Path(os.getenv("DATA_DIR", ROOT / "data"))
    cfg = {
        "DATA_DIR": data_dir,
        "DATABASE_PATH": str(data_dir / "amatashield.db"),
        "EVIDENCE_DIR": data_dir / "evidence",
        "SCHEMA_PATH": ROOT / "database" / "schema.sql",
        "FRONTEND_DIR": ROOT / "frontend",
        "GEMINI_API_KEY": os.getenv("GEMINI_API_KEY", "").strip(),
        "GEMINI_MODEL": os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip(),
        "MAX_UPLOAD_BYTES": int(os.getenv("MAX_UPLOAD_MB", "8")) * 1024 * 1024,
        "BOOKING_HOLD_SECONDS": int(os.getenv("BOOKING_HOLD_SECONDS", "60")),
        "SESSION_COOKIE_SECURE": os.getenv("SESSION_COOKIE_SECURE", "0") == "1",
        "SESSION_COOKIE_HTTPONLY": True,
        "SESSION_COOKIE_SAMESITE": "Lax",
        "PERMANENT_SESSION_LIFETIME": 60 * 60 * 24 * 7,
        "LOGIN_MAX_FAILURES": 5,
        "LOGIN_WINDOW_SECONDS": 600,
        "TESTING": False,
    }
    if overrides:
        cfg.update(overrides)
    if "SECRET_KEY" not in cfg:
        cfg["SECRET_KEY"] = _secret_key(Path(cfg["DATA_DIR"]))
    cfg["MAX_CONTENT_LENGTH"] = cfg["MAX_UPLOAD_BYTES"] + 1024 * 64
    return cfg
