// Two gigabytes unless STORAGE_QUOTA_BYTES says otherwise. A missing or
// unusable value falls back to the default so a blank env var cannot set
// the cap to zero and reject every upload.
const DEFAULT_QUOTA = 2 * 1024 * 1024 * 1024;

export function storageQuotaBytes() {
  const configured = Number(process.env.STORAGE_QUOTA_BYTES);

  if (Number.isFinite(configured) && configured > 0) return configured;

  return DEFAULT_QUOTA;
}
