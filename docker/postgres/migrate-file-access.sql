-- Existing volumes skip init.sql. This adds per-recipient access and copies
-- current shares in as view, which is what those addresses could already do.
CREATE TABLE IF NOT EXISTS file_access (
  file_id uuid NOT NULL REFERENCES files (id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('view', 'edit', 'manage')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (file_id, email)
);

CREATE INDEX IF NOT EXISTS file_access_email_idx ON file_access (email);

INSERT INTO file_access (file_id, email, role)
SELECT f.id, lower(btrim(recipient)), 'view'
FROM files f
CROSS JOIN LATERAL unnest(f.shared_with) AS recipient
WHERE btrim(recipient) <> ''
ON CONFLICT (file_id, email) DO NOTHING;
