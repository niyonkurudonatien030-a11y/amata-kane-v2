"""Gemini-assisted features. Every AI result is a SUGGESTION that a person must confirm."""
import json

from flask import Blueprint, current_app, g, jsonify

from .. import audit
from ..ai import gemini_client as gc
from ..ai import prompts, rules
from ..common import ApiError, field, iso, json_body, new_public_id
from ..database import get_db
from ..security import login_required
from ..services import storage
from ..services import transactions as T

bp = Blueprint("ai", __name__, url_prefix="/api")
LANGS = ("en", "rw", "fr")
CONFIRMABLE = ("document_type", "reading_sg", "temperature_c", "amount_rwf", "date", "reference", "notes")
DISCLAIMER = "AI output is a suggestion. A person must check it against the original file."


def _analysis_json(a_row, ev_pid):
    return {"id": a_row["public_id"], "kind": a_row["kind"], "evidence_id": ev_pid, "status": a_row["status"],
            "model": a_row["model"], "language": a_row["language"],
            "extracted": json.loads(a_row["extracted_json"]) if a_row["extracted_json"] else None,
            "confirmed": json.loads(a_row["confirmed_json"]) if a_row["confirmed_json"] else None,
            "created_at": a_row["created_at"], "disclaimer": DISCLAIMER}


@bp.get("/ai/status")
@login_required()
def ai_status():
    return jsonify({"gemini_configured": bool(current_app.config["GEMINI_API_KEY"]),
                    "model": current_app.config["GEMINI_MODEL"], "languages": list(LANGS)})


@bp.post("/evidence/<ev_pid>/analyze")
@login_required()
def analyze(ev_pid):
    db, d = get_db(), json_body()
    lang = field(d, "language", required=False, default="en", choices=LANGS)
    e = db.execute("SELECT e.*, t.public_id AS tx FROM evidence e JOIN transactions t ON t.id=e.transaction_id WHERE e.public_id=?", (ev_pid,)).fetchone()
    if not e:
        raise ApiError("Evidence not found", 404)
    tx, rel = T.require_access(db, e["tx"], g.user)
    if not (rel["party"] or rel["driver"]):
        raise ApiError("Only people in this deal can analyse its evidence", 403)
    path = storage.resolve_path(current_app.config["EVIDENCE_DIR"], e["stored_filename"])
    try:
        text = gc.generate([{"text": prompts.image_prompt(e["category"])}, gc.image_part(path.read_bytes(), e["mime_type"])],
                           system=prompts.IMAGE_SYSTEM, json_mode=True)
    except gc.AIUnavailable as exc:
        raise ApiError(str(exc), 503, "AI_UNAVAILABLE")
    parsed = gc.parse_json(text)
    pid = new_public_id("AI")
    db.execute("INSERT INTO ai_analyses (public_id, transaction_id, evidence_id, requested_by, kind, model, language, raw_text, "
               "extracted_json, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
               (pid, tx["id"], e["id"], g.user["id"], "IMAGE_EXTRACTION", current_app.config["GEMINI_MODEL"], lang, text,
                json.dumps(parsed) if parsed else None, "SUGGESTED", iso()))
    audit.log(db, "AI_EXTRACTION_SUGGESTED", g.user["id"], tx["id"], {"analysis": pid, "evidence": ev_pid, "parsed": bool(parsed)})
    row = db.execute("SELECT * FROM ai_analyses WHERE public_id=?", (pid,)).fetchone()
    out = _analysis_json(row, ev_pid)
    out["raw_text"] = text if not parsed else None
    return jsonify(out), 201


def _get_analysis(db, aid):
    a = db.execute("SELECT a.*, t.public_id AS tx, e.public_id AS ev FROM ai_analyses a JOIN transactions t ON t.id=a.transaction_id "
                   "LEFT JOIN evidence e ON e.id=a.evidence_id WHERE a.public_id=?", (aid,)).fetchone()
    if not a:
        raise ApiError("AI analysis not found", 404)
    tx, rel = T.require_access(db, a["tx"], g.user)
    if not (rel["party"] or rel["driver"]):
        raise ApiError("AI analysis not found", 404)
    if a["kind"] != "IMAGE_EXTRACTION" or a["status"] != "SUGGESTED":
        raise ApiError("This suggestion was already handled", 409)
    return a, tx


@bp.post("/ai/<aid>/confirm")
@login_required()
def confirm(aid):
    db, d = get_db(), json_body()
    a, tx = _get_analysis(db, aid)
    values = d.get("values")
    if not isinstance(values, dict) or not values:
        raise ApiError("Send the values you checked, e.g. {\"reading_sg\": 1.028}", 422)
    clean = {}
    for k in CONFIRMABLE:
        if k in values and values[k] not in (None, ""):
            clean[k] = values[k]
    if "reading_sg" in clean:
        clean["reading_sg"] = field(clean, "reading_sg", "float", min=0.9, max=1.2)
    if "amount_rwf" in clean:
        clean["amount_rwf"] = field(clean, "amount_rwf", "int", min=0)
    if "temperature_c" in clean:
        clean["temperature_c"] = field(clean, "temperature_c", "float", min=-5, max=80)
    for k in ("document_type", "date", "reference", "notes"):
        if k in clean:
            clean[k] = field(clean, k, maxlen=200)
    db.execute("UPDATE ai_analyses SET status='CONFIRMED', confirmed_by=?, confirmed_json=?, confirmed_at=? WHERE id=?",
               (g.user["id"], json.dumps(clean), iso(), a["id"]))
    audit.log(db, "AI_SUGGESTION_CONFIRMED", g.user["id"], tx["id"], {"analysis": aid, "fields": sorted(clean)})
    return jsonify(_analysis_json(db.execute("SELECT * FROM ai_analyses WHERE id=?", (a["id"],)).fetchone(), a["ev"]))


@bp.post("/ai/<aid>/reject")
@login_required()
def reject(aid):
    db = get_db()
    a, tx = _get_analysis(db, aid)
    db.execute("UPDATE ai_analyses SET status='REJECTED', confirmed_by=?, confirmed_at=? WHERE id=?", (g.user["id"], iso(), a["id"]))
    audit.log(db, "AI_SUGGESTION_REJECTED", g.user["id"], tx["id"], {"analysis": aid})
    return jsonify(_analysis_json(db.execute("SELECT * FROM ai_analyses WHERE id=?", (a["id"],)).fetchone(), a["ev"]))


@bp.get("/transactions/<pid>/checks")
@login_required()
def checks(pid):
    """Rule-based consistency checks. Works without any AI service."""
    db = get_db()
    tx, rel = T.require_access(db, pid, g.user)
    return jsonify({"findings": rules.check(rules.build_facts(db, tx)), "source": "rules"})


@bp.post("/transactions/<pid>/ai-summary")
@login_required()
def ai_summary(pid):
    db, d = get_db(), json_body()
    lang = field(d, "language", required=False, default="en", choices=LANGS)
    tx, rel = T.require_access(db, pid, g.user, party_only=True)
    facts = rules.build_facts(db, tx)
    findings = rules.check(facts)
    result = {"findings": findings, "ai": None, "ai_available": True, "language": lang, "disclaimer": DISCLAIMER}
    try:
        text = gc.generate([{"text": prompts.summary_prompt(json.dumps(facts, ensure_ascii=False), lang)}],
                           system=prompts.SUMMARY_SYSTEM, json_mode=True)
    except gc.AIUnavailable as exc:
        result.update(ai_available=False, notice=f"{exc} Showing rule-based checks only.")
        return jsonify(result)
    parsed = gc.parse_json(text) or {"summary": text}
    pid_ai = new_public_id("AI")
    db.execute("INSERT INTO ai_analyses (public_id, transaction_id, requested_by, kind, model, language, raw_text, extracted_json, status, created_at) "
               "VALUES (?,?,?,?,?,?,?,?,'INFO',?)", (pid_ai, tx["id"], g.user["id"], "TRANSACTION_SUMMARY",
                                                    current_app.config["GEMINI_MODEL"], lang, text, json.dumps(parsed), iso()))
    audit.log(db, "AI_SUMMARY_GENERATED", g.user["id"], tx["id"], {"analysis": pid_ai, "language": lang})
    result["ai"] = parsed
    return jsonify(result)
