-- Applied on an empty data volume. An existing volume ignores this file;
-- schema changes after the first boot have to be applied by hand.
-- Account. Email is the sign-in identity and the share target.
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  avatar text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- The current sign-in code for a user. Only the hash is stored.
-- attempts counts wrong submissions against this code.
CREATE TABLE IF NOT EXISTS email_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Safe to re-run on a database created before attempts existed.
ALTER TABLE email_otps ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS email_otps_user_id_idx ON email_otps (user_id);

-- One row per signed-in browser. The cookie holds the raw token; this table
-- holds its hash, so a database leak does not hand out live sessions.
-- Deleting every row for a user is "sign out everywhere".
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The catalog. storage_key points at the private object. shared_with mirrors
-- the emails in file_access so a list query can match an address without a join.
-- The role for each address lives in file_access.
CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name text NOT NULL,
  extension text NOT NULL DEFAULT '',
  type text NOT NULL,
  size bigint NOT NULL,
  storage_key text NOT NULL UNIQUE,
  shared_with text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS files_owner_id_idx ON files (owner_id);
CREATE INDEX IF NOT EXISTS files_type_idx ON files (type);

-- What a non-owner may do with a file. permissions is a set of keys from
-- sharePrivileges in constants/index.ts. view is always included.
-- email is stored lowercase. An existing volume does not replay this file.
CREATE TABLE IF NOT EXISTS file_access (
  file_id uuid NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  email text NOT NULL,
  permissions text[] NOT NULL DEFAULT '{view}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (file_id, email)
);

CREATE INDEX IF NOT EXISTS file_access_email_idx ON file_access (email);

-- Speeds ILIKE '%term%' on file names. A plain btree does not help that pattern.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS files_name_trgm_idx ON files USING gin (name gin_trgm_ops);

-- A direct upload that has been authorized but not yet accepted as a file.
-- declared_size counts toward the quota so concurrent uploads cannot overshoot.
-- expires_at is how an abandoned browser PUT becomes eligible for cleanup.
CREATE TABLE IF NOT EXISTS pending_uploads (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  storage_key text NOT NULL UNIQUE,
  file_name text NOT NULL,
  extension text NOT NULL DEFAULT '',
  content_type text NOT NULL,
  declared_size bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pending_uploads_expires_at_idx ON pending_uploads (expires_at);

-- Keys whose database change has committed and whose bucket delete has not.
-- Written in the same transaction as the catalog change. The sweep retries
-- rows with attempts under 10. This is not a two-phase commit with the bucket.
CREATE TABLE IF NOT EXISTS object_deletions (
  storage_key text PRIMARY KEY,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
