import postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

// Next.js hot reload imports this module again. The client lives on globalThis
// so a reload does not open another pool against the same database.
const globalForDb = globalThis as unknown as { sql?: Sql };

export function getDb() {
  if (!globalForDb.sql) {
    const url = process.env.DATABASE_URL;

    // Fail at the first query rather than at build time. The build does not
    // have a database, and pages that need one already run on demand.
    if (!url) throw new Error('DATABASE_URL is not set');

    globalForDb.sql = postgres(url, {
      max: 10,
      idle_timeout: 20,
    });
  }

  return globalForDb.sql;
}

// Column names match the tables in docker/postgres/init.sql. File rows also
// carry the owner's display fields because list queries join users once
// instead of looking the owner up per file.
export type UserRow = {
  id: string;
  email: string;
  full_name: string;
  avatar: string;
  created_at: Date | string;
  updated_at: Date | string;
};

export type FileRow = {
  id: string;
  name: string;
  extension: string;
  type: string;
  size: number | string;
  storage_key: string;
  shared_with: string[] | null;
  grants: { email: string; permissions: string[] }[] | string | null;
  permissions: string[] | null;
  created_at: Date | string;
  updated_at: Date | string;
  owner_id: string;
  owner_full_name: string;
  owner_email: string;
  owner_avatar: string;
};
