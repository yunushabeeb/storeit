-- Replaces the single role with a list of privileges so each one can be
-- toggled on its own. view was open and download, edit added rename, and
-- manage added delete.
ALTER TABLE file_access
  ADD COLUMN IF NOT EXISTS permissions text[] NOT NULL DEFAULT '{view}';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'file_access' AND column_name = 'role'
  ) THEN
    UPDATE file_access
    SET permissions = CASE role
      WHEN 'manage' THEN ARRAY['view', 'rename', 'delete']::text[]
      WHEN 'edit' THEN ARRAY['view', 'rename']::text[]
      ELSE ARRAY['view']::text[]
    END;

    ALTER TABLE file_access DROP COLUMN role;
  END IF;
END $$;
