import type postgres from 'postgres';
import { getDb } from '@/lib/db';
import { deleteObject } from '@/lib/storage';

// postgres.js gives a transaction a different type from the pool, even though
// both are tagged-template clients. Callers inside sql.begin pass the transaction.
type QueryClient = postgres.Sql | postgres.TransactionSql;

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Object delete failed';
}

// Same lock id on every connection that touches one object key. hashtextextended
// is a bigint, which is what Postgres advisory locks require. A transaction lock
// (pg_advisory_xact_lock) and a session lock (pg_advisory_lock) share one space,
// so a commit and a bucket delete for the same key cannot overlap.
function lockKey(storageKey: string) {
  return storageKey;
}

// Records the intent to remove an object. This statement belongs in the same
// database transaction as the row it depends on (the file delete, or the
// pending-upload delete). If that transaction rolls back, this row rolls back
// with it, and the object is left alone.
export async function queueObjectDeletion(sql: QueryClient, storageKey: string) {
  await sql`
    INSERT INTO object_deletions (storage_key)
    VALUES (${storageKey})
    ON CONFLICT (storage_key) DO NOTHING
  `;
}

// Performs the bucket delete after the database transaction has committed.
// The advisory lock is session-scoped and must be taken on a reserved connection:
// the pool would otherwise run the unlock on a different connection than the lock.
// The lock is held across the bucket call so a finishing upload cannot insert a
// files row for a key that this function has already decided to remove.
export async function settleObjectDeletion(storageKey: string) {
  const connection = await getDb().reserve();

  try {
    await connection`
      SELECT pg_advisory_lock(hashtextextended(${lockKey(storageKey)}, 0))
    `;

    // A files row means a request committed the object as a real file while
    // this key was also queued (the sweep can race a slow completeUpload).
    // Drop the intent and leave the bytes in place.
    const owned = await connection<{ owned: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM files WHERE storage_key = ${storageKey}
      ) AS owned
    `;

    if (owned[0]?.owned) {
      await connection`
        DELETE FROM object_deletions WHERE storage_key = ${storageKey}
      `;
      return 'kept' as const;
    }

    try {
      // DeleteObject is idempotent. A missing key is still success, which is
      // what we want when the browser never finished the PUT.
      await deleteObject(storageKey);
      await connection`
        DELETE FROM object_deletions WHERE storage_key = ${storageKey}
      `;
      return 'removed' as const;
    } catch (error) {
      // The catalog change already committed. Leaving the intent row is the
      // retry. A second database transaction here does not undo the first one.
      console.error('Object delete failed; left queued for retry', storageKey, error);
      await connection`
        INSERT INTO object_deletions (storage_key, last_error)
        VALUES (${storageKey}, ${errorText(error)})
        ON CONFLICT (storage_key) DO UPDATE
        SET attempts = object_deletions.attempts + 1,
            last_error = EXCLUDED.last_error,
            updated_at = now()
        WHERE object_deletions.storage_key = ${storageKey}
      `;
      return 'retry' as const;
    }
  } finally {
    await connection`
      SELECT pg_advisory_unlock(hashtextextended(${lockKey(storageKey)}, 0))
    `.catch((error) => {
      console.error('Failed to release the object lock', storageKey, error);
    });
    connection.release();
  }
}

// Moves every expired direct upload into the deletion queue in one statement,
// then asks the bucket to drop those objects. The statement is the transaction:
// a crash cannot delete the pending row and forget the key.
export async function sweepOrphans() {
  const expired = await getDb()<{ storage_key: string }[]>`
    WITH expired AS (
      DELETE FROM pending_uploads
      WHERE expires_at < now()
      RETURNING storage_key
    )
    INSERT INTO object_deletions (storage_key)
    SELECT storage_key FROM expired
    ON CONFLICT (storage_key) DO NOTHING
    RETURNING storage_key
  `;

  const queued = await getDb()<{ storage_key: string }[]>`
    SELECT storage_key
    FROM object_deletions
    WHERE attempts < 10
    ORDER BY updated_at
    LIMIT 100
  `;

  let deletionsFinished = 0;

  for (const row of queued) {
    const outcome = await settleObjectDeletion(row.storage_key);

    if (outcome === 'removed') deletionsFinished += 1;
  }

  return {
    expiredUploads: expired.length,
    deletionsRetried: queued.length,
    deletionsFinished,
  };
}
