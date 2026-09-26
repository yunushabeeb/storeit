'use server';

// File bytes never travel through these functions. The browser PUTs to the
// bucket with a presigned URL. These actions decide whether that object may
// become a row in `files`, and they sign the URLs used to open it later.

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { MAX_FILE_SIZE, normalizeSharePermissions } from '@/constants';
import { findUserByEmail, getSessionUser } from '@/lib/auth';
import { getDb, type FileRow, type UserRow } from '@/lib/db';
import { queueObjectDeletion, settleObjectDeletion } from '@/lib/object-retention';
import { storageQuotaBytes } from '@/lib/quota';
import { sendShareEmail } from '@/lib/mail';
import { scanBytes } from '@/lib/scanner';
import {
  contentTypeFor,
  fileAccessUrls,
  headObject,
  objectKey,
  openObject,
  presignUpload,
} from '@/lib/storage';
import { getFileType, parseStringify } from '@/lib/utils';

const handleError = (error: unknown, message: string): never => {
  console.error(error, message);
  throw error;
};

const iso = (value: Date | string) => new Date(value).toISOString();

const permissionList = (value: unknown) => {
  const raw = Array.isArray(value) ? value : [];

  return normalizeSharePermissions(
    raw.filter((item): item is string => typeof item === 'string'),
  );
};

const grantsFrom = (row: FileRow) => {
  let raw: unknown = row.grants;

  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = [];
    }
  }
  const parsed = (Array.isArray(raw) ? raw : []).flatMap((item) => {
    if (!item || typeof item !== 'object') return [];

    const email = String((item as { email?: string }).email || '')
      .trim()
      .toLowerCase();
    const permissions = permissionList(
      (item as { permissions?: unknown }).permissions,
    );

    if (!email.includes('@')) return [];

    return [{ email, permissions }];
  });

  if (parsed.length) return parsed;

  return (row.shared_with ?? [])
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.includes('@'))
    .map((email) => ({ email, permissions: normalizeSharePermissions([]) }));
};

// Signs a view URL and a download URL for one row. Signing is local HMAC
// work. The bucket is not contacted here.
const presentFile = async (
  row: FileRow,
  viewer: { id: string; email: string },
) => {
  const access = await fileAccessUrls(row);
  const isOwner = row.owner_id === viewer.id;
  const shares = grantsFrom(row);
  // A recipient does not receive the other addresses on the file.
  const granted = permissionList(row.permissions);

  return {
    $id: row.id,
    $createdAt: iso(row.created_at),
    $updatedAt: iso(row.updated_at),
    name: row.name,
    extension: row.extension,
    type: row.type,
    size: Number(row.size),
    url: access.url,
    downloadUrl: access.downloadUrl,
    users: isOwner ? shares.map((share) => share.email) : [],
    shares: isOwner ? shares : [],
    permissions: isOwner ? [] : granted,
    access: isOwner ? 'owner' : 'shared',
    bucketFileId: row.storage_key,
    accountId: row.owner_id,
    owner: {
      $id: row.owner_id,
      accountId: row.owner_id,
      fullName: row.owner_full_name,
      email: row.owner_email,
      avatar: row.owner_avatar,
    },
  };
};

const fileColumns = (sql: ReturnType<typeof getDb>, email: string) => sql`
  f.id, f.name, f.extension, f.type, f.size, f.storage_key, f.shared_with,
  f.created_at, f.updated_at, f.owner_id,
  u.full_name AS owner_full_name,
  u.email AS owner_email,
  u.avatar AS owner_avatar,
  (
    SELECT a.permissions FROM file_access a
    WHERE a.file_id = f.id AND a.email = ${email}
  ) AS permissions,
  COALESCE(
    (
      SELECT json_agg(
        json_build_object('email', a.email, 'permissions', a.permissions)
        ORDER BY a.email
      )
      FROM file_access a
      WHERE a.file_id = f.id
    ),
    '[]'::json
  ) AS grants
`;

// `!` is the ESCAPE character in the ILIKE below. Without this, a search for
// "%" or "_" would become a wildcard instead of a literal character.
const escapeLike = (value: string) => value.replace(/[!%_]/g, (char) => `!${char}`);

const orderBy = (sort: string) => {
  const [field, direction] = (sort || '$createdAt-desc').split('-');
  // The sort string comes from the query string. Only these three columns are
  // interpolated, and only ASC or DESC, so the value cannot change the query.
  const column =
    field === 'name' ? 'f.name' : field === 'size' ? 'f.size' : 'f.created_at';
  const dir = direction === 'asc' ? 'ASC' : 'DESC';

  return `${column} ${dir}`;
};

async function requireUser() {
  const user = await getSessionUser();

  // redirect() throws a framework control-flow exception. Callers must not
  // wrap this in a catch that turns it into a generic error response.
  if (!user) redirect('/sign-in');

  return user;
}

async function loadFile(id: string, email: string) {
  const sql = getDb();
  const rows = await sql<FileRow[]>`
    SELECT ${fileColumns(sql, email)}
    FROM files f
    JOIN users u ON u.id = f.owner_id
    WHERE f.id = ${id}
    LIMIT 1
  `;

  return rows[0] ?? null;
}

// Removes the reservation and records that the object must be deleted.
// Both writes commit together. The bucket call happens only after that commit,
// so a rollback still leaves the bytes and the pending row intact for a retry.
async function discardPending(pendingId: string, storageKey: string) {
  const sql = getDb();

  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${storageKey}, 0))`;
    await tx`DELETE FROM pending_uploads WHERE id = ${pendingId}`;
    await queueObjectDeletion(tx, storageKey);
  });

  await settleObjectDeletion(storageKey);
}

async function reservedBytes(ownerId: string, sql: ReturnType<typeof getDb>) {
  const rows = await sql<{ reserved: number | string }[]>`
    SELECT
      (
        SELECT COALESCE(SUM(size), 0) FROM files WHERE owner_id = ${ownerId}
      ) + (
        SELECT COALESCE(SUM(declared_size), 0)
        FROM pending_uploads
        WHERE owner_id = ${ownerId}
          AND expires_at > now()
      ) AS reserved
  `;

  return Number(rows[0]?.reserved || 0);
}

export const createUpload = async ({
  name,
  size,
  ownerId,
}: {
  name: string;
  size: number;
  ownerId: string;
}) => {
  const session = await requireUser();

  // The client sends ownerId, but the session is the authority. A mismatched
  // id would otherwise reserve quota against someone else's account.
  if (session.id !== ownerId) {
    return parseStringify({ error: 'You can only upload files to your own account.' });
  }

  if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_SIZE) {
    return parseStringify({ error: 'File is too large. Max file size is 50MB.' });
  }

  const sql = getDb();
  const uploadId = randomUUID();
  const originalName = path.basename(name || 'upload');
  const { extension } = getFileType(originalName);
  const contentType = contentTypeFor(extension);
  const storageKey = objectKey(session.id, uploadId);

  try {
    await sql.begin(async (tx) => {
      // Serializes quota checks for this user. Two uploads starting together
      // would otherwise both see the same free space and both pass.
      await tx`SELECT id FROM users WHERE id = ${session.id} FOR UPDATE`;
      const reserved = await reservedBytes(
        session.id,
        tx as unknown as ReturnType<typeof getDb>,
      );

      if (reserved + size > storageQuotaBytes()) {
        throw new Error('Storage limit reached');
      }

      await tx`
        INSERT INTO pending_uploads (
          id, owner_id, storage_key, file_name, extension, content_type,
          declared_size, expires_at
        )
        VALUES (
          ${uploadId},
          ${session.id},
          ${storageKey},
          ${originalName},
          ${extension},
          ${contentType},
          ${size},
          now() + interval '1 hour'
        )
      `;
    });

    // Signing happens after the commit so a slow bucket call does not hold
    // the user-row lock for the whole round trip.
    const uploadUrl = await presignUpload({ key: storageKey, contentType });

    return parseStringify({ uploadId, uploadUrl, contentType });
  } catch (error) {
    // The pending row may already be committed. Remove it so a failed sign
    // does not keep counting toward the quota until the hour is up.
    await sql`DELETE FROM pending_uploads WHERE id = ${uploadId}`.catch(() => undefined);
    const message = error instanceof Error ? error.message : 'Could not start the upload';

    return parseStringify({
      error: message === 'Storage limit reached' ? message : 'Could not start the upload',
    });
  }
};

export const completeUpload = async ({
  uploadId,
  path: currentPath,
}: {
  uploadId: string;
  path: string;
}) => {
  const session = await requireUser();
  const sql = getDb();
  const pendingRows = await sql<
    {
      id: string;
      storage_key: string;
      file_name: string;
      extension: string;
      declared_size: number | string;
    }[]
  >`
    SELECT id, storage_key, file_name, extension, declared_size
    FROM pending_uploads
    WHERE id = ${uploadId}
      AND owner_id = ${session.id}
      AND expires_at > now()
    LIMIT 1
  `;
  const pending = pendingRows[0];

  if (!pending) {
    return parseStringify({ error: 'Upload expired. Please try again.' });
  }

  try {
    const stored = await headObject(pending.storage_key);
    const actualSize = stored?.size ?? 0;

    if (!stored || actualSize <= 0) {
      return parseStringify({ error: 'The file did not reach storage. Please try again.' });
    }

    if (actualSize > Number(pending.declared_size) || actualSize > MAX_FILE_SIZE) {
      await discardPending(pending.id, pending.storage_key);
      return parseStringify({ error: 'File is too large. Max file size is 50MB.' });
    }

    let scan: { clean: boolean; signature?: string };

    try {
      scan = await scanBytes(await openObject(pending.storage_key));
    } catch (error) {
      // Leave the object and the pending row. The person can finish this
      // upload again when the scanner is back; deleting it would force a re-upload.
      console.error(error);
      return parseStringify({
        error: 'File scanning is unavailable. Try again shortly.',
      });
    }

    if (!scan.clean) {
      console.error('Rejected infected upload', pending.id, scan.signature);
      await discardPending(pending.id, pending.storage_key);
      return parseStringify({ error: 'This file was rejected by the security scan.' });
    }

    const { type } = getFileType(pending.file_name);

    await sql.begin(async (tx) => {
      // Held until this transaction ends. settleObjectDeletion takes the same
      // lock, so it cannot remove the object between the existence check and
      // the files insert.
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${pending.storage_key}, 0))`;

      const stillPending = await tx<{ id: string }[]>`
        SELECT id
        FROM pending_uploads
        WHERE id = ${pending.id}
          AND owner_id = ${session.id}
          AND expires_at > now()
        FOR UPDATE
      `;

      if (!stillPending.length) throw new Error('Upload expired');

      // The sweep may have removed the object after the scan read it.
      // Inserting a file row in that case would publish a missing object.
      const stillStored = await headObject(pending.storage_key);

      if (!stillStored || stillStored.size <= 0) throw new Error('Object missing');

      await tx`SELECT id FROM users WHERE id = ${session.id} FOR UPDATE`;
      const usage = await tx<{ used: number | string }[]>`
        SELECT
          (
            SELECT COALESCE(SUM(size), 0) FROM files WHERE owner_id = ${session.id}
          ) + (
            SELECT COALESCE(SUM(declared_size), 0)
            FROM pending_uploads
            WHERE owner_id = ${session.id}
              AND id <> ${pending.id}
              AND expires_at > now()
          ) AS used
      `;

      if (Number(usage[0]?.used || 0) + actualSize > storageQuotaBytes()) {
        throw new Error('Storage limit reached');
      }

      await tx`
        INSERT INTO files (
          id, owner_id, name, extension, type, size, storage_key
        )
        VALUES (
          ${pending.id},
          ${session.id},
          ${pending.file_name},
          ${pending.extension},
          ${type},
          ${actualSize},
          ${pending.storage_key}
        )
      `;
      await tx`DELETE FROM pending_uploads WHERE id = ${pending.id}`;
      // The sweep may already have queued this key. The file row now owns it.
      await tx`DELETE FROM object_deletions WHERE storage_key = ${pending.storage_key}`;
    });

    const created = await loadFile(pending.id, session.email);

    revalidatePath(currentPath);

    return parseStringify({
      file: created ? await presentFile(created, session) : { $id: pending.id },
    });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : '';

    // Quota and a missing object cannot be retried against the same bytes.
    // A scanner outage and a transient database error can, so those leave the
    // pending row and the object in place.
    if (message === 'Storage limit reached' || message === 'Object missing') {
      await discardPending(pending.id, pending.storage_key);
      return parseStringify({
        error:
          message === 'Storage limit reached'
            ? message
            : 'The file did not reach storage. Please try again.',
      });
    }

    if (message === 'Upload expired') {
      return parseStringify({ error: 'Upload expired. Please try again.' });
    }

    return parseStringify({ error: 'Could not store the file. Try again.' });
  }
};

export const getFiles = async ({
  types = [],
  searchText = '',
  sort = '$createdAt-desc',
  limit,
}: GetFilesProps) => {
  const currentUser = await requireUser();
  const sql = getDb();
  const search = searchText.trim();

  try {
    // Owned files and files with a row in file_access for this email.
    // The address is lowercase because share writes store it that way.
    const filters = () => sql`
      WHERE (
        f.owner_id = ${currentUser.id}
        OR EXISTS (
          SELECT 1 FROM file_access a
          WHERE a.file_id = f.id AND a.email = ${currentUser.email}
        )
      )
      ${types.length ? sql`AND f.type = ANY(${types})` : sql``}
      ${
        search
          ? sql`AND f.name ILIKE ${`%${escapeLike(search)}%`} ESCAPE '!'`
          : sql``
      }
    `;

    const [rows, countRows] = await Promise.all([
      sql<FileRow[]>`
        SELECT ${fileColumns(sql, currentUser.email)}
        FROM files f
        JOIN users u ON u.id = f.owner_id
        ${filters()}
        ORDER BY ${sql.unsafe(orderBy(sort))}
        ${limit ? sql`LIMIT ${limit}` : sql``}
      `,
      sql<{ total: number | string }[]>`
        SELECT COUNT(*) AS total
        FROM files f
        ${filters()}
      `,
    ]);

    return parseStringify({
      total: Number(countRows[0]?.total || 0),
      documents: await Promise.all(
        rows.map((row) => presentFile(row, currentUser)),
      ),
    });
  } catch (error) {
    handleError(error, 'Failed to get files');
  }
};

export const renameFile = async ({
  fileId,
  name,
  extension,
  path: currentPath,
}: RenameFileProps) => {
  const session = await requireUser();

  try {
    const trimmed = name.trim();
    const suffix = extension ? `.${extension}` : '';
    // The form submits the name, and the extension is stored separately.
    // Strip a typed extension so "report.pdf" plus ".pdf" does not become
    // "report.pdf.pdf".
    const base =
      suffix && trimmed.toLowerCase().endsWith(suffix.toLowerCase())
        ? trimmed.slice(0, -suffix.length)
        : trimmed;
    const newName = `${base}${suffix}`;
    // The owner can always rename. A recipient can rename only when that
    // privilege is on. The menu hides the action; this is the check that counts.
    const updated = await getDb()`
      UPDATE files
      SET name = ${newName}, updated_at = now()
      WHERE id = ${fileId}
        AND (
          owner_id = ${session.id}
          OR EXISTS (
            SELECT 1 FROM file_access a
            WHERE a.file_id = files.id
              AND a.email = ${session.email}
              AND 'rename' = ANY(a.permissions)
          )
        )
      RETURNING id
    `;

    if (!updated.length) throw new Error('File not found');

    const file = await loadFile(fileId, session.email);

    revalidatePath(currentPath);

    return parseStringify(file ? await presentFile(file, session) : { $id: fileId });
  } catch (error) {
    handleError(error, 'Failed to rename file');
  }
};

export const updateFileUsers = async ({
  fileId,
  shares,
  path: currentPath,
}: UpdateFileUsersProps) => {
  const session = await requireUser();
  // The server replaces the grant list. Callers send the full set.
  // Duplicates, blanks, unknown privileges, and the owner's own address are dropped.
  // The owner already has the file, so sharing it back to them would only add noise.
  const sharedWith = new Map<string, SharePrivilege[]>();

  for (const share of shares) {
    const email = share.email.trim().toLowerCase();

    if (!email.includes('@') || email === session.email) continue;

    sharedWith.set(email, normalizeSharePermissions(share.permissions ?? []));
  }

  const normalized = [...sharedWith.entries()].map(([email, permissions]) => ({
    email,
    permissions,
  }));

  try {
    const saved = await getDb().begin(async (tx) => {
      const current = await tx<{ name: string }[]>`
        SELECT name
        FROM files
        WHERE id = ${fileId}
          AND owner_id = ${session.id}
        FOR UPDATE
      `;
      const existing = current[0];

      if (!existing) throw new Error('File not found');

      const previous = await tx<{ email: string }[]>`
        SELECT email FROM file_access WHERE file_id = ${fileId}
      `;
      const alreadyShared = new Set(previous.map((row) => row.email));
      // Only addresses that were not on the file before get a message.
      // Changing a role, or removing someone, must not re-mail the rest.
      const added = normalized.filter((share) => !alreadyShared.has(share.email));
      const emails = normalized.map((share) => share.email);

      if (emails.length) {
        await tx`
          DELETE FROM file_access
          WHERE file_id = ${fileId}
            AND NOT (email = ANY(${emails}))
        `;
      } else {
        await tx`DELETE FROM file_access WHERE file_id = ${fileId}`;
      }

      for (const share of normalized) {
        await tx`
          INSERT INTO file_access (file_id, email, permissions)
          VALUES (${fileId}, ${share.email}, ${share.permissions})
          ON CONFLICT (file_id, email) DO UPDATE
          SET permissions = EXCLUDED.permissions, updated_at = now()
        `;
      }

      await tx`
        UPDATE files
        SET shared_with = ${emails}, updated_at = now()
        WHERE id = ${fileId}
      `;

      return { name: existing.name, added };
    });

    await Promise.all(
      saved.added.map(async (share) => {
        try {
          const account = await findUserByEmail(share.email);

          await sendShareEmail({
            to: share.email,
            fileName: saved.name,
            sharerName: session.full_name,
            hasAccount: Boolean(account),
            permissions: share.permissions,
          });
        } catch (error) {
          // The share is already stored. A mail failure must not pretend the
          // recipient was never added, and must not block the other notices.
          console.error('Failed to notify share recipient', share.email, error);
        }
      }),
    );

    const file = await loadFile(fileId, session.email);

    revalidatePath(currentPath);

    return parseStringify(file ? await presentFile(file, session) : { $id: fileId });
  } catch (error) {
    handleError(error, 'Failed to update file users');
  }
};

export const deleteFile = async ({
  fileId,
  path: currentPath,
}: DeleteFileProps) => {
  const session = await requireUser();

  try {
    // The file disappears from the catalog and the deletion intent is recorded
    // in the same commit. The bucket delete follows. If that call fails, the
    // intent row remains and the sweep retries it. Rolling the file row back
    // would show the user a file whose bytes might already be gone.
    const storageKey = await getDb().begin(async (tx) => {
      const removed = await tx<{ storage_key: string }[]>`
        DELETE FROM files
        WHERE id = ${fileId}
          AND (
            owner_id = ${session.id}
            OR EXISTS (
              SELECT 1 FROM file_access a
              WHERE a.file_id = files.id
                AND a.email = ${session.email}
                AND 'delete' = ANY(a.permissions)
            )
          )
        RETURNING storage_key
      `;
      const key = removed[0]?.storage_key;

      if (!key) throw new Error('File not found');

      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      await queueObjectDeletion(tx, key);

      return key;
    });

    await settleObjectDeletion(storageKey);

    revalidatePath(currentPath);

    return parseStringify({ status: 'success' });
  } catch (error) {
    handleError(error, 'Failed to delete file');
  }
};

export async function getTotalSpaceUsed() {
  const currentUser: UserRow = await requireUser();

  try {
    // One grouped query. Loading every file into the process just to sum sizes
    // would grow with the account for a number the database can compute.
    const files = await getDb()<
      { type: string; size: number | string; latest: Date | string | null }[]
    >`
      SELECT type, COALESCE(SUM(size), 0) AS size, MAX(updated_at) AS latest
      FROM files
      WHERE owner_id = ${currentUser.id}
      GROUP BY type
    `;

    const totalSpace = {
      image: { size: 0, latestDate: '' },
      document: { size: 0, latestDate: '' },
      video: { size: 0, latestDate: '' },
      audio: { size: 0, latestDate: '' },
      other: { size: 0, latestDate: '' },
      used: 0,
      all: storageQuotaBytes(),
    };

    files.forEach((file) => {
      const fileType = file.type as FileType;
      const bucket = totalSpace[fileType];

      // `used` and `all` are numbers on the same object. A type value that is
      // not one of the five buckets must not be treated as a category.
      if (!bucket || typeof bucket === 'number') return;

      bucket.size = Number(file.size);
      totalSpace.used += Number(file.size);
      bucket.latestDate = file.latest ? iso(file.latest) : '';
    });

    return parseStringify(totalSpace);
  } catch (error) {
    handleError(error, 'Error calculating total space used');
  }
}
