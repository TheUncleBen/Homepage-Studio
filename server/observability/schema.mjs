// Database layouts. Fresh-deploy rule (owner, 25 Oct 2026): until 1.0.0 a
// schema change means a new SCHEMA_VERSION and a fresh database, never a
// migration. A database with another version is set aside, not adopted.
export const SCHEMA_VERSION = 2;

export const MAIN_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS segment (
  stream TEXT NOT NULL, seq INTEGER NOT NULL, file TEXT NOT NULL, day TEXT NOT NULL,
  first_ts INTEGER, last_ts INTEGER, events INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (stream, seq)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS event_repeat (id TEXT PRIMARY KEY, stream TEXT NOT NULL, seq INTEGER NOT NULL, repeat INTEGER NOT NULL, last_ts INTEGER NOT NULL) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS personal (id TEXT PRIMARY KEY, ts INTEGER NOT NULL, user_id TEXT, ip TEXT, username TEXT) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS personal_ts ON personal (ts);
CREATE INDEX IF NOT EXISTS personal_user ON personal (user_id);
CREATE TABLE IF NOT EXISTS monitor_state (
  monitor_id TEXT PRIMARY KEY, scope TEXT NOT NULL, state TEXT NOT NULL, since INTEGER NOT NULL,
  last_check INTEGER, last_ms REAL, last_code INTEGER, last_class TEXT, last_message TEXT,
  failures INTEGER NOT NULL DEFAULT 0, successes INTEGER NOT NULL DEFAULT 0, cert_expires INTEGER,
  incident_id TEXT, details TEXT) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS check_result (monitor_id TEXT NOT NULL, ts INTEGER NOT NULL, state TEXT NOT NULL, ms REAL, code INTEGER, error_class TEXT, message TEXT, PRIMARY KEY (monitor_id, ts)) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS check_result_ts ON check_result (ts);
CREATE TABLE IF NOT EXISTS check_hour (monitor_id TEXT NOT NULL, start INTEGER NOT NULL, up INTEGER NOT NULL DEFAULT 0, down INTEGER NOT NULL DEFAULT 0, maint INTEGER NOT NULL DEFAULT 0, unknown INTEGER NOT NULL DEFAULT 0, ms_sum REAL NOT NULL DEFAULT 0, ms_n INTEGER NOT NULL DEFAULT 0, ms_min REAL, ms_max REAL, PRIMARY KEY (monitor_id, start)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS check_day (monitor_id TEXT NOT NULL, start INTEGER NOT NULL, up INTEGER NOT NULL DEFAULT 0, down INTEGER NOT NULL DEFAULT 0, maint INTEGER NOT NULL DEFAULT 0, unknown INTEGER NOT NULL DEFAULT 0, ms_sum REAL NOT NULL DEFAULT 0, ms_n INTEGER NOT NULL DEFAULT 0, ms_min REAL, ms_max REAL, PRIMARY KEY (monitor_id, start)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS incident (id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL, scope TEXT NOT NULL, name TEXT NOT NULL, opened INTEGER NOT NULL, closed INTEGER, cause TEXT, error_class TEXT, ack_by TEXT, ack_at INTEGER, notified INTEGER) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS incident_open ON incident (closed, opened);
CREATE INDEX IF NOT EXISTS incident_scope ON incident (scope, opened);
CREATE TABLE IF NOT EXISTS incident_event (incident_id TEXT NOT NULL, ts INTEGER NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, actor TEXT, PRIMARY KEY (incident_id, ts, seq)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS delivery (id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, ts INTEGER NOT NULL, subject TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL, error TEXT) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS delivery_ts ON delivery (ts);
CREATE TABLE IF NOT EXISTS metric_series (id INTEGER PRIMARY KEY, scope TEXT NOT NULL, resource TEXT NOT NULL, name TEXT NOT NULL, label TEXT, unit TEXT, format TEXT, created INTEGER NOT NULL, last_seen INTEGER NOT NULL, UNIQUE (scope, resource, name));
CREATE TABLE IF NOT EXISTS metric_point (series_id INTEGER NOT NULL, ts INTEGER NOT NULL, value REAL NOT NULL, PRIMARY KEY (series_id, ts)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS metric_15m (series_id INTEGER NOT NULL, ts INTEGER NOT NULL, min REAL, max REAL, sum REAL NOT NULL, count INTEGER NOT NULL, last REAL, PRIMARY KEY (series_id, ts)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS docker_cursor (endpoint TEXT NOT NULL, container TEXT NOT NULL, since INTEGER NOT NULL, PRIMARY KEY (endpoint, container)) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS alert_state (rule_id TEXT PRIMARY KEY, last_fired INTEGER) WITHOUT ROWID;
`;

export const SEGMENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS event (
  rid INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, ts INTEGER NOT NULL, received INTEGER NOT NULL,
  severity INTEGER NOT NULL, category TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
  scope TEXT NOT NULL, resource TEXT, panel TEXT, event_type TEXT NOT NULL, error_class TEXT,
  message TEXT NOT NULL, fields TEXT NOT NULL, actor TEXT, correlation TEXT, fingerprint TEXT NOT NULL,
  restricted INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS event_ts ON event (ts);
CREATE INDEX IF NOT EXISTS event_scope_ts ON event (scope, ts);
CREATE INDEX IF NOT EXISTS event_severity_ts ON event (severity, ts);
CREATE INDEX IF NOT EXISTS event_source_ts ON event (source_type, ts);
CREATE INDEX IF NOT EXISTS event_resource_ts ON event (resource, ts);
CREATE INDEX IF NOT EXISTS event_type_ts ON event (event_type, ts);
CREATE INDEX IF NOT EXISTS event_fingerprint_ts ON event (fingerprint, ts);
-- A widget's Logs block asks for its panel's latest lines every minute.
CREATE INDEX IF NOT EXISTS event_panel_ts ON event (panel, ts);
CREATE VIRTUAL TABLE IF NOT EXISTS event_fts USING fts5(text, content='', tokenize='unicode61', prefix='2 3');
`;
