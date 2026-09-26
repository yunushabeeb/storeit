import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandInput,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const PRESIGN_SECONDS = 60 * 60;
const UPLOAD_PRESIGN_SECONDS = 15 * 60;

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  json: 'application/json',
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
};

type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
};

// One client and one in-flight bucket setup per process. A hot reload keeps
// the client; the promise is cleared if setup throws so the next call retries.
const globalForStorage = globalThis as unknown as {
  client?: S3Client;
  bucketReady?: Promise<void>;
};

function storageConfig(): StorageConfig {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Object storage is not configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY.',
    );
  }

  return {
    endpoint,
    bucket,
    region: process.env.S3_REGION || 'auto',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    accessKeyId,
    secretAccessKey,
  };
}

function getClient() {
  if (!globalForStorage.client) {
    const config = storageConfig();

    globalForStorage.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      // R2 rejects the default CRC32 checksum headers added by recent AWS SDK releases.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  return globalForStorage.client;
}

async function ensureBucket() {
  if (!globalForStorage.bucketReady) {
    globalForStorage.bucketReady = (async () => {
      const { bucket } = storageConfig();
      const client = getClient();

      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch (error) {
        const status =
          error && typeof error === 'object' && '$metadata' in error
            ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata
                ?.httpStatusCode
            : undefined;

        // 404 means the bucket is not there yet, so create it. Any other
        // status is a credentials or network failure and must not be hidden
        // behind a create attempt.
        if (status && status !== 404) throw error;

        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      }

      const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

      try {
        await client.send(
          new PutBucketCorsCommand({
            Bucket: bucket,
            CORSConfiguration: {
              CORSRules: [
                {
                  AllowedHeaders: ['*'],
                  AllowedMethods: ['GET', 'PUT', 'HEAD'],
                  AllowedOrigins: [
                    origin,
                    'http://localhost:3000',
                    'http://127.0.0.1:3000',
                  ],
                  ExposeHeaders: ['ETag'],
                  MaxAgeSeconds: 3600,
                },
              ],
            },
          }),
        );
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'Code' in error
            ? String((error as { Code?: string }).Code)
            : '';

        // Community MinIO does not implement bucket CORS. It allows the app
        // origin through MINIO_API_CORS_ALLOW_ORIGIN instead.
        if (code === 'NotImplemented') return;

        console.error(
          'Could not set bucket CORS. Browser uploads need this origin allowed:',
          origin,
          error,
        );
      }
    })().catch((error) => {
      globalForStorage.bucketReady = undefined;
      throw error;
    });
  }

  return globalForStorage.bucketReady;
}

export function contentTypeFor(extension: string) {
  return MIME_TYPES[extension.toLowerCase()] || 'application/octet-stream';
}

export function objectKey(ownerId: string, fileId: string) {
  return `owners/${ownerId}/${fileId}`;
}

function contentDisposition(
  disposition: 'inline' | 'attachment',
  filename: string,
) {
  const fallback = filename.replace(/["\r\n\\]/g, '') || 'download';

  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// SVG and HTML can execute script when a browser renders them from the bucket
// origin. Forcing a download keeps the view URL from becoming that render.
function viewDisposition(extension: string) {
  return extension === 'svg' || extension === 'html' || extension === 'htm'
    ? 'attachment'
    : 'inline';
}

export async function putObject({
  key,
  body,
  contentType,
}: {
  key: string;
  body: Buffer;
  contentType: string;
}) {
  await ensureBucket();
  const { bucket } = storageConfig();

  await new Upload({
    client: getClient(),
    params: {
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ContentLength: body.length,
    },
  }).done();
}

export async function presignUpload({
  key,
  contentType,
}: {
  key: string;
  contentType: string;
}) {
  await ensureBucket();
  const { bucket } = storageConfig();

  return getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: UPLOAD_PRESIGN_SECONDS },
  );
}

export async function headObject(key: string) {
  const { bucket } = storageConfig();

  try {
    const result = await getClient().send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );

    return { size: Number(result.ContentLength ?? 0) };
  } catch (error) {
    const status =
      error && typeof error === 'object' && '$metadata' in error
        ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode
        : undefined;

    // A missing object is a normal answer during upload finish. Other statuses
    // are storage failures and should surface.
    if (status === 404) return null;

    throw error;
  }
}

export async function openObject(key: string) {
  const { bucket } = storageConfig();
  const result = await getClient().send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
  );

  const body = result.Body as AsyncIterable<Uint8Array> | undefined;

  if (!body || typeof body[Symbol.asyncIterator] !== 'function') {
    throw new Error('Stored object cannot be streamed');
  }

  return body;
}

export async function deleteObject(key: string) {
  const { bucket } = storageConfig();

  await getClient().send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}

export async function presignDownload({
  key,
  filename,
  extension,
  disposition,
}: {
  key: string;
  filename: string;
  extension: string;
  disposition: 'inline' | 'attachment';
}) {
  const { bucket } = storageConfig();
  const input: GetObjectCommandInput = {
    Bucket: bucket,
    Key: key,
    ResponseContentType: contentTypeFor(extension),
    ResponseContentDisposition: contentDisposition(disposition, filename),
    ResponseCacheControl: 'private, max-age=300',
  };

  return getSignedUrl(getClient(), new GetObjectCommand(input), {
    expiresIn: PRESIGN_SECONDS,
  });
}

export async function fileAccessUrls(file: {
  storage_key: string;
  name: string;
  extension: string;
}) {
  const [url, downloadUrl] = await Promise.all([
    presignDownload({
      key: file.storage_key,
      filename: file.name,
      extension: file.extension,
      disposition: viewDisposition(file.extension),
    }),
    presignDownload({
      key: file.storage_key,
      filename: file.name,
      extension: file.extension,
      disposition: 'attachment',
    }),
  ]);

  return { url, downloadUrl };
}
