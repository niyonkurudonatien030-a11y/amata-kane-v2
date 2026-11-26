"""Generate documentation/API.md from the real Flask routes:   python scripts/make_api_docs.py"""
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend.app import create_app  # noqa: E402

tmp = Path(tempfile.mkdtemp())
app = create_app({"DATA_DIR": tmp, "DATABASE_PATH": str(tmp / "d.db"), "EVIDENCE_DIR": tmp / "e", "SECRET_KEY": "x"})
lines = ["# AmataShield API reference", "",
         "Generated from the running code by `scripts/make_api_docs.py`. All endpoints are under `/api`, return JSON, and (except health, register, login and the cooperative list) need a logged-in session cookie.",
         "Every POST/PATCH/DELETE must send the header `X-Requested-With: AmataShield`. Errors look like `{\"error\": \"message\"}` with an HTTP status (401 not logged in, 403 not allowed, 404 not found or not yours, 409 wrong state, 422 invalid input, 503 AI unavailable).", ""]
groups = {}
for r in sorted(app.url_map.iter_rules(), key=lambda r: r.rule):
    if not r.rule.startswith("/api/"):
        continue
    fn = app.view_functions[r.endpoint]
    doc = (fn.__doc__ or "").strip().splitlines()[0] if fn.__doc__ else ""
    for m in sorted(r.methods - {"HEAD", "OPTIONS"}):
        groups.setdefault(r.endpoint.split(".")[0], []).append((m, r.rule, doc, fn.__name__))
for g, items in groups.items():
    lines += [f"## {g}", "", "| Method | Path | Handler | Note |", "|---|---|---|---|"]
    lines += [f"| {m} | `{p}` | `{n}` | {d} |" for m, p, d, n in items]
    lines.append("")
(ROOT / "documentation" / "API.md").write_text("\n".join(lines), encoding="utf-8")
print("wrote documentation/API.md with", sum(len(v) for v in groups.values()), "endpoints")
