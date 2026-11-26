-- AmataShield database schema (SQLite). All timestamps are UTC ISO-8601 text.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  role          TEXT NOT NULL CHECK (role IN ('farmer','buyer','driver','coop_admin','admin')),
  full_name     TEXT NOT NULL,
  phone         TEXT NOT NULL UNIQUE,           -- normalised +2507XXXXXXXX
  email         TEXT,
  password_hash TEXT NOT NULL,                  -- werkzeug salted hash, never plain text
  district      TEXT,
  organisation  TEXT,                           -- cooperative / company / collection centre
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deals (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id             TEXT NOT NULL UNIQUE,   -- human-friendly id, e.g. AS-20261121-K3F9
  deal_type             TEXT NOT NULL CHECK (deal_type IN ('sell','buy')),
  creator_id            INTEGER NOT NULL REFERENCES users(id),
  seller_id             INTEGER REFERENCES users(id),
  buyer_id              INTEGER REFERENCES users(id),
  driver_id             INTEGER REFERENCES users(id),
  litres                REAL NOT NULL CHECK (litres > 0),
  price_per_litre       REAL NOT NULL CHECK (price_per_litre > 0),
  total_value           REAL NOT NULL,
  location              TEXT NOT NULL,
  district              TEXT,
  delivery_at           TEXT,
  quality_requirements  TEXT,
  terms                 TEXT,
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN
      ('open','pending_acceptance','agreed','in_transit','delivered','received','completed','disputed','cancelled')),
  status_before_dispute TEXT,
  payment_status        TEXT NOT NULL DEFAULT 'unconfirmed' CHECK (payment_status IN
      ('unconfirmed','reported','confirmed','disputed')),
  seller_accepted_at    TEXT,
  buyer_accepted_at     TEXT,
  terms_hash            TEXT,                   -- sha256 of agreed terms, fixed at agreement time
  driver_fee            REAL,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deals_status ON deals(status);
CREATE INDEX IF NOT EXISTS idx_deals_district ON deals(district);

CREATE TABLE IF NOT EXISTS driver_applications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id       INTEGER NOT NULL REFERENCES deals(id),
  driver_id     INTEGER NOT NULL REFERENCES users(id),
  proposed_fee  REAL,
  message       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at    TEXT NOT NULL,
  UNIQUE (deal_id, driver_id)
);

CREATE TABLE IF NOT EXISTS evidence (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id        INTEGER NOT NULL REFERENCES deals(id),
  submitted_by   INTEGER NOT NULL REFERENCES users(id),
  category       TEXT NOT NULL CHECK (category IN
      ('quality_measurement','lactometer_photo','delivery_photo','collection_receipt','payment_receipt','other')),
  stored_name    TEXT NOT NULL,                 -- random file name on disk; original file never modified
  original_name  TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  sha256         TEXT NOT NULL,                 -- fingerprint of the original file (tamper evidence)
  note           TEXT,
  measurement    TEXT,                          -- value typed by the user (e.g. lactometer reading)
  captured_at    TEXT,                          -- device time claimed by the browser (not trusted)
  created_at     TEXT NOT NULL                  -- server time (trusted)
);
CREATE INDEX IF NOT EXISTS idx_evidence_deal ON evidence(deal_id);

CREATE TABLE IF NOT EXISTS payments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id       INTEGER NOT NULL REFERENCES deals(id),
  reported_by   INTEGER NOT NULL REFERENCES users(id),
  amount        REAL NOT NULL CHECK (amount > 0),
  method        TEXT NOT NULL,                  -- mobile_money / bank / cash / other
  reference     TEXT,                           -- transaction ID typed by the buyer
  evidence_id   INTEGER REFERENCES evidence(id),
  status        TEXT NOT NULL DEFAULT 'reported' CHECK (status IN ('reported','confirmed','disputed')),
  response_note TEXT,
  responded_by  INTEGER REFERENCES users(id),
  responded_at  TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_analyses (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id        INTEGER NOT NULL REFERENCES deals(id),
  evidence_id    INTEGER REFERENCES evidence(id),
  kind           TEXT NOT NULL CHECK (kind IN ('receipt','lactometer','summary','consistency','dispute_help')),
  model          TEXT NOT NULL,
  language       TEXT NOT NULL DEFAULT 'en',
  output_json    TEXT NOT NULL,                 -- raw AI draft, kept unchanged
  review_status  TEXT NOT NULL DEFAULT 'pending_review' CHECK (review_status IN ('pending_review','confirmed','rejected')),
  confirmed_json TEXT,                          -- values after the human checked/corrected them
  requested_by   INTEGER NOT NULL REFERENCES users(id),
  reviewed_by    INTEGER REFERENCES users(id),
  reviewed_at    TEXT,
  created_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS disputes (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id        INTEGER NOT NULL REFERENCES deals(id),
  opened_by      INTEGER NOT NULL REFERENCES users(id),
  reason         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  final_outcome  TEXT,
  resolved_by    INTEGER REFERENCES users(id),
  created_at     TEXT NOT NULL,
  resolved_at    TEXT
);

CREATE TABLE IF NOT EXISTS dispute_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  dispute_id    INTEGER NOT NULL REFERENCES disputes(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  kind          TEXT NOT NULL CHECK (kind IN ('comment','evidence','proposal','agree','resolution')),
  body          TEXT,
  evidence_id   INTEGER REFERENCES evidence(id),
  ref_event_id  INTEGER REFERENCES dispute_events(id),   -- the proposal an 'agree' refers to
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id    INTEGER REFERENCES deals(id),
  user_id    INTEGER REFERENCES users(id),
  action     TEXT NOT NULL,
  detail     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_deal ON audit_log(deal_id);
