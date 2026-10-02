-- __SCHEMA__ is replaced only after strict application identifier validation.
CREATE TABLE __SCHEMA__.schema_migrations (
  version integer PRIMARY KEY CHECK (version > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$')
);
CREATE TABLE __SCHEMA__.matches (
  match_id text PRIMARY KEY,
  revision integer NOT NULL CHECK (revision >= 0),
  phase text NOT NULL CHECK (phase IN ('lobby','active','paused','finished','void')),
  invite_code text UNIQUE,
  room_id text UNIQUE,
  record jsonb NOT NULL CHECK (jsonb_typeof(record) = 'object'),
  CHECK (record->>'matchId' = match_id),
  CHECK ((record->>'revision')::integer = revision),
  CHECK (record->>'phase' = phase),
  CHECK (invite_code IS NOT DISTINCT FROM record->'lobby'->>'inviteCode'),
  CHECK (room_id IS NOT DISTINCT FROM record->'lobby'->>'roomId')
);
CREATE INDEX matches_recoverable ON __SCHEMA__.matches (phase, match_id)
  WHERE phase IN ('lobby','active','paused');
CREATE TABLE __SCHEMA__.snapshots (
  match_id text NOT NULL REFERENCES __SCHEMA__.matches(match_id),
  revision integer NOT NULL CHECK (revision >= 0),
  record jsonb NOT NULL,
  PRIMARY KEY (match_id, revision),
  CHECK (record->>'matchId' = match_id),
  CHECK ((record->>'revision')::integer = revision)
);
CREATE TABLE __SCHEMA__.commands (
  match_id text NOT NULL, actor_id text NOT NULL, request_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  fingerprint text NOT NULL, result jsonb NOT NULL, committed_at bigint NOT NULL,
  PRIMARY KEY (match_id, actor_id, request_id),
  UNIQUE (match_id, revision),
  FOREIGN KEY (match_id, revision) REFERENCES __SCHEMA__.snapshots(match_id, revision)
);
CREATE TABLE __SCHEMA__.events (
  match_id text NOT NULL, revision integer NOT NULL CHECK (revision > 0),
  event_index integer NOT NULL CHECK (event_index >= 0), event jsonb NOT NULL,
  PRIMARY KEY (match_id, revision, event_index),
  FOREIGN KEY (match_id, revision) REFERENCES __SCHEMA__.snapshots(match_id, revision)
);
CREATE TABLE __SCHEMA__.seats (
  match_id text NOT NULL REFERENCES __SCHEMA__.matches(match_id),
  color text NOT NULL CHECK (color IN ('R','B','Y','K')), seat jsonb NOT NULL,
  PRIMARY KEY (match_id, color), CHECK (seat->>'color' = color)
);
CREATE TABLE __SCHEMA__.deadlines (
  match_id text NOT NULL REFERENCES __SCHEMA__.matches(match_id),
  kind text NOT NULL CHECK (kind IN ('lobby','recovery','retention','seat:R','seat:B','seat:Y','seat:K')),
  deadline bigint NOT NULL CHECK (deadline >= 0), PRIMARY KEY (match_id, kind)
);
CREATE INDEX deadlines_due ON __SCHEMA__.deadlines (deadline);
-- Reserved ranked ledger boundaries; no admission or settlement methods yet.
CREATE TABLE __SCHEMA__.accounts (
  account_id text PRIMARY KEY, rating integer NOT NULL DEFAULT 1200,
  restricted_until bigint NOT NULL DEFAULT 0 CHECK (restricted_until >= 0)
);
CREATE TABLE __SCHEMA__.admission_locks (
  account_id text PRIMARY KEY REFERENCES __SCHEMA__.accounts(account_id),
  match_id text NOT NULL REFERENCES __SCHEMA__.matches(match_id),
  color text NOT NULL CHECK (color IN ('R','B','Y','K')), UNIQUE (match_id, color)
);
CREATE TABLE __SCHEMA__.settlements (
  match_id text PRIMARY KEY REFERENCES __SCHEMA__.matches(match_id),
  settlement_id text UNIQUE NOT NULL, kind text NOT NULL CHECK (kind IN ('victory','void')),
  settled_at bigint NOT NULL CHECK (settled_at >= 0), details jsonb NOT NULL
);
CREATE TABLE __SCHEMA__.rating_entries (
  settlement_id text NOT NULL REFERENCES __SCHEMA__.settlements(settlement_id),
  account_id text NOT NULL REFERENCES __SCHEMA__.accounts(account_id), delta integer NOT NULL,
  PRIMARY KEY (settlement_id, account_id)
);
CREATE TABLE __SCHEMA__.server_instances (
  instance_id text PRIMARY KEY,
  last_heartbeat_at bigint NOT NULL CHECK (last_heartbeat_at >= 0),
  status text NOT NULL CHECK (status IN ('active','stopped')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
