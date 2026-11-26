"""SQLite connection handling.

isolation_level=None means we control transactions explicitly: app.py issues BEGIN IMMEDIATE for every
write request and commits only if the response succeeded, so a failed request never half-saves.
"""
import sqlite3

from flask import current_app, g


def connect(path):
    con = sqlite3.connect(path, isolation_level=None, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def get_db():
    if "db" not in g:
        g.db = connect(current_app.config["DATABASE_PATH"])
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        if db.in_transaction:
            db.execute("ROLLBACK")
        db.close()


def init_db(db_path, schema_path):
    con = connect(db_path)
    try:
        con.execute("PRAGMA journal_mode = WAL")
        with open(schema_path, encoding="utf-8") as fh:
            con.executescript(fh.read())
    finally:
        con.close()


def rows(cur):
    return [dict(r) for r in cur.fetchall()]
