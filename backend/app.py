"""AmataShield application factory.   Run:  python run.py"""
import logging
from pathlib import Path

from flask import Flask, g, jsonify, request, send_from_directory
from werkzeug.exceptions import HTTPException

from .common import ApiError
from .config import load_config
from .database import close_db, get_db, init_db
from .security import check_csrf, load_user


def create_app(overrides=None):
    cfg = load_config(overrides)
    app = Flask(__name__, static_folder=None)
    app.config.update(cfg)
    Path(cfg["DATA_DIR"]).mkdir(parents=True, exist_ok=True)
    Path(cfg["EVIDENCE_DIR"]).mkdir(parents=True, exist_ok=True)
    init_db(cfg["DATABASE_PATH"], cfg["SCHEMA_PATH"])
    app.teardown_appcontext(close_db)

    from .routes import admin, ai, auth, dashboard, disputes, listings, payments, transactions
    for module in (auth, listings, transactions, payments, disputes, ai, dashboard, admin):
        app.register_blueprint(module.bp)

    @app.before_request
    def guard():
        if not request.path.startswith("/api/"):
            return
        check_csrf()
        db = get_db()
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            db.execute("BEGIN IMMEDIATE")  # one writer at a time; everything below commits or rolls back together
        load_user()

    @app.after_request
    def finish(resp):
        db = g.get("db")
        if db is not None and db.in_transaction:
            db.execute("COMMIT" if resp.status_code < 400 else "ROLLBACK")
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "same-origin"
        resp.headers["Permissions-Policy"] = "camera=(self), geolocation=(self), microphone=()"
        if not request.path.startswith("/api/"):
            resp.headers["Content-Security-Policy"] = (
                "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
                "script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'")
        elif resp.mimetype == "application/json":
            resp.headers["Cache-Control"] = "no-store"
        return resp

    @app.errorhandler(ApiError)
    def api_error(e):
        return jsonify({"error": e.message, "code": e.code}), e.status

    @app.errorhandler(HTTPException)
    def http_error(e):
        if request.path.startswith("/api/"):
            msg = "File is too large" if e.code == 413 else e.description
            return jsonify({"error": msg}), e.code
        return e

    @app.errorhandler(Exception)
    def unexpected(e):
        logging.exception("Unhandled error")
        return jsonify({"error": "Something went wrong on the server. Please try again."}), 500

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok", "service": "AmataShield", "version": "1.0.0-mvp"})

    # ---- frontend ----
    frontend = Path(cfg["FRONTEND_DIR"])

    @app.get("/")
    def home():
        return send_from_directory(frontend, "index.html")

    @app.get("/<name>.html")
    def page(name):
        return send_from_directory(frontend, f"{name}.html")

    @app.get("/<folder>/<path:filename>")
    def assets(folder, filename):
        if folder not in ("css", "js", "assets"):
            raise ApiError("Not found", 404)
        return send_from_directory(frontend / folder, filename)

    return app
