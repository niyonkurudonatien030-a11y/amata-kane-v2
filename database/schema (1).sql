-- AmataShield database schema (SQLite 3). Safe to run repeatedly (IF NOT EXISTS).
-- Money is stored as whole RWF integers. Times are UTC ISO-8601 text: YYYY-MM-DDTHH:MM:SSZ.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cooperatives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  district TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,              -- normalised +2507XXXXXXXX
  email TEXT,
  password_hash TEXT NOT NULL,             -- never the password itself
  role TEXT NOT NULL CHECK (role IN ('farmer','buyer','driver','collector','coop_admin','admin')),
  business_name TEXT,
  district TEXT,
  sector TEXT,
  latitude REAL,
  longitude REAL,
  cooperative_id INTEGER REFERENCES cooperatives(id),
  vehicle_type TEXT,                       -- drivers: bicycle, motorcycle, car, truck ...
  is_active INTEGER NOT NULL DEFAULT 1,
  is_verified INTEGER NOT NULL DEFAULT 0,  -- set by a system administrator
  consent_at TEXT NOT NULL,                -- when the user accepted the privacy notice
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  method_type TEXT NOT NULL CHECK (method_type IN ('momo_code','momo_phone','bank','other')),
  label TEXT NOT NULL,
  account_value TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  listing_type TEXT NOT NULL CHECK (listing_type IN ('SELL','BUY')),
  owner_id INTEGER NOT NULL REFERENCES users(id),
  litres_total REAL NOT NULL CHECK (litres_total > 0),
  litres_remaining REAL NOT NULL CHECK (litres_remaining >= 0),
  price_per_litre INTEGER NOT NULL CHECK (price_per_litre > 0),
  location_name TEXT NOT NULL,
  district TEXT,
  latitude REAL,
  longitude REAL,
  available_from TEXT NOT NULL,
  available_until TEXT,
  min_lactometer REAL,                     -- agreed requirement written by the parties, not by AmataShield
  max_lactometer REAL,
  max_temperature_c REAL,
  terms TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','CANCELLED')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  listing_id INTEGER REFERENCES listings(id),
  seller_id INTEGER NOT NULL REFERENCES users(id),   -- farmer / collector / cooperative
  buyer_id INTEGER NOT NULL REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  litres REAL NOT NULL CHECK (litres > 0),
  accepted_litres REAL,
  price_per_litre INTEGER NOT NULL,
  total_value INTEGER NOT NULL,
  location_name TEXT NOT NULL,
  district TEXT,
  delivery_at TEXT,
  min_lactometer REAL,
  max_lactometer REAL,
  max_temperature_c REAL,
  terms TEXT,
  status TEXT NOT NULL CHECK (status IN
    ('REQUESTED','AGREED','IN_TRANSIT','DELIVERED','ACCEPTED','COMPLETED','DISPUTED','EXPIRED','DECLINED','CANCELLED')),
  status_before_dispute TEXT,
  payment_status TEXT NOT NULL DEFAULT 'UNCONFIRMED'
    CHECK (payment_status IN ('UNCONFIRMED','PAYMENT_REPORTED','CONFIRMED_BY_BOTH','DISPUTED')),
  transport_mode TEXT NOT NULL DEFAULT 'UNDECIDED' CHECK (transport_mode IN ('UNDECIDED','SELF','DRIVER')),
  carrier_id INTEGER REFERENCES users(id),
  hold_expires_at TEXT,
  seller_accepted_at TEXT,
  buyer_accepted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS delivery_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  posted_by INTEGER NOT NULL REFERENCES users(id),
  wage_rwf INTEGER NOT NULL CHECK (wage_rwf >= 0),
  agreed_wage_rwf INTEGER,
  contact_method TEXT NOT NULL DEFAULT 'app' CHECK (contact_method IN ('app','phone','sms','whatsapp')),
  vehicle_pref TEXT,
  dropoff_name TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ASSIGNED','ACCEPTED','COMPLETED','CANCELLED')),
  stage TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (stage IN ('NOT_STARTED','AT_FARMER','IN_TRANSIT','ARRIVED')),
  assigned_driver_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS driver_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES delivery_jobs(id),
  driver_id INTEGER NOT NULL REFERENCES users(id),
  proposed_wage_rwf INTEGER NOT NULL CHECK (proposed_wage_rwf >= 0),
  message TEXT,
  status TEXT NOT NULL DEFAULT 'APPLIED' CHECK (status IN ('APPLIED','SELECTED','REJECTED','WITHDRAWN')),
  created_at TEXT NOT NULL,
  UNIQUE (job_id, driver_id)
);

CREATE TABLE IF NOT EXISTS evidence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  submitted_by INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL CHECK (category IN
    ('quality_measurement','lactometer_photo','delivery_photo','collection_receipt','payment_receipt','other_document')),
  stored_filename TEXT NOT NULL,           -- original bytes, never modified
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,                    -- fingerprint of the original file
  captured_at TEXT,                        -- reported by the phone, not verified
  latitude REAL,
  longitude REAL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quality_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  stage TEXT NOT NULL CHECK (stage IN ('PICKUP','ARRIVAL')),
  recorded_by INTEGER NOT NULL REFERENCES users(id),
  evidence_id INTEGER REFERENCES evidence(id),
  tester_name TEXT,
  reading_sg REAL,                         -- lactometer reading as specific gravity, e.g. 1.028
  temperature_c REAL,
  tested_at TEXT,
  photo_legible INTEGER NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('WITHIN_AGREED_RANGE','OUTSIDE_AGREED_RANGE','NO_AGREED_RANGE','REDO_REQUIRED')),
  result_detail TEXT,
  waived_by INTEGER REFERENCES users(id),
  waived_at TEXT,
  waiver_note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  evidence_id INTEGER REFERENCES evidence(id),
  requested_by INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('IMAGE_EXTRACTION','TRANSACTION_SUMMARY')),
  model TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  raw_text TEXT,
  extracted_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('SUGGESTED','CONFIRMED','REJECTED','INFO')),
  confirmed_by INTEGER REFERENCES users(id),
  confirmed_json TEXT,
  confirmed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('MILK','TRANSPORT')),
  payer_id INTEGER NOT NULL REFERENCES users(id),
  payee_id INTEGER NOT NULL REFERENCES users(id),
  amount_due_rwf INTEGER NOT NULL,
  amount_reported_rwf INTEGER,
  method_type TEXT,
  method_detail TEXT,
  reference TEXT,
  proof_evidence_id INTEGER REFERENCES evidence(id),
  status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','REPORTED','CONFIRMED','REJECTED')),
  reported_at TEXT,
  confirmed_at TEXT,
  rejected_at TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id TEXT NOT NULL UNIQUE,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  opened_by INTEGER NOT NULL REFERENCES users(id),
  category TEXT NOT NULL CHECK (category IN ('quality','quantity','payment','delivery','price','other')),
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED','WITHDRAWN')),
  final_outcome TEXT,
  resolved_by INTEGER REFERENCES users(id),
  resolved_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dispute_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispute_id INTEGER NOT NULL REFERENCES disputes(id),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  event_type TEXT NOT NULL CHECK (event_type IN
    ('OPENED','COMMENT','EVIDENCE','PROPOSAL','PROPOSAL_ACCEPTED','PROPOSAL_REJECTED','RESOLVED','WITHDRAWN')),
  body TEXT,
  evidence_id INTEGER REFERENCES evidence(id),
  ref_event_id INTEGER REFERENCES dispute_events(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  link TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Append-only, hash-chained event history. Each entry_hash covers the previous entry's hash,
-- so editing or removing an old row breaks the chain (see /api/admin/audit/verify).
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id INTEGER REFERENCES transactions(id),
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  details_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  entry_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status, listing_type);
CREATE INDEX IF NOT EXISTS idx_tx_seller ON transactions(seller_id);
CREATE INDEX IF NOT EXISTS idx_tx_buyer ON transactions(buyer_id);
CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_evidence_tx ON evidence(transaction_id);
CREATE INDEX IF NOT EXISTS idx_audit_tx ON audit_log(transaction_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

-- Immutability guards: evidence, audit history and dispute events can be added but never edited or deleted.
CREATE TRIGGER IF NOT EXISTS evidence_no_update BEFORE UPDATE ON evidence
BEGIN SELECT RAISE(ABORT, 'evidence records are immutable'); END;
CREATE TRIGGER IF NOT EXISTS evidence_no_delete BEFORE DELETE ON evidence
BEGIN SELECT RAISE(ABORT, 'evidence records cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit entries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit entries cannot be deleted'); END;
CREATE TRIGGER IF NOT EXISTS dispute_events_no_update BEFORE UPDATE ON dispute_events
BEGIN SELECT RAISE(ABORT, 'dispute events are immutable'); END;
CREATE TRIGGER IF NOT EXISTS dispute_events_no_delete BEFORE DELETE ON dispute_events
BEGIN SELECT RAISE(ABORT, 'dispute events cannot be deleted'); END;
-- Quality checks: only the waiver columns may change after the record is created.
CREATE TRIGGER IF NOT EXISTS quality_core_no_update
BEFORE UPDATE OF transaction_id, stage, recorded_by, evidence_id, tester_name, reading_sg, temperature_c,
                 tested_at, photo_legible, result, result_detail, created_at ON quality_checks
BEGIN SELECT RAISE(ABORT, 'quality measurements are immutable'); END;
CREATE TRIGGER IF NOT EXISTS quality_no_delete BEFORE DELETE ON quality_checks
BEGIN SELECT RAISE(ABORT, 'quality checks cannot be deleted'); END;
