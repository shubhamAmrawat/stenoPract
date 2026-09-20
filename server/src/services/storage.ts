import { env } from '../config/env.js';

/** Where uploaded files live. One small interface so the rest of the app never touches the S3 SDK (and tests can swap in memory). */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** A short-lived address the browser can PUT one file to directly, so large files never pass through our server. */
  presignPut(key: string, contentType: string, expiresInSeconds: number): Promise<string>;
  /** Size of a stored object, or null when there is none. */
  head(key: string): Promise<{ size: number } | null>;
  /** The address a browser uses to read the object. */
  urlFor(key: string): string;
}

/** Cloudflare R2 through its S3-compatible API. The SDK is loaded on first use, so a server without uploads never pays for it. */
export class R2Storage implements ObjectStorage {
  private client: Promise<import('@aws-sdk/client-s3').S3Client> | undefined;

  constructor(private readonly cfg: typeof env.r2) {}

  /** The name the object really has in the bucket: our key inside the app's own folder, if one is set. */
  private full(key: string): string {
    return this.cfg.keyPrefix ? `${this.cfg.keyPrefix}/${key}` : key;
  }

  private async s3() {
    this.client ??= import('@aws-sdk/client-s3').then(
      ({ S3Client }) =>
        new S3Client({
          region: 'auto',
          endpoint: this.cfg.endpoint,
          // R2 takes both address styles; path style needs no per-bucket DNS name and works the same everywhere.
          forcePathStyle: true,
          // Only add the SDK's extra checksum headers where S3 insists on them. R2 does not need them.
          requestChecksumCalculation: 'WHEN_REQUIRED',
          responseChecksumValidation: 'WHEN_REQUIRED',
          credentials: { accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey },
        }),
    );
    return this.client;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const [{ PutObjectCommand }, client] = await Promise.all([import('@aws-sdk/client-s3'), this.s3()]);
    await client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: this.full(key),
        Body: body,
        ContentType: contentType,
        // Every upload gets a new key, so a copy can be cached for a year without ever going stale.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async remove(key: string): Promise<void> {
    const [{ DeleteObjectCommand }, client] = await Promise.all([import('@aws-sdk/client-s3'), this.s3()]);
    await client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: this.full(key) }));
  }

  async presignPut(key: string, contentType: string, expiresInSeconds: number): Promise<string> {
    const [{ PutObjectCommand }, { getSignedUrl }, client] = await Promise.all([import('@aws-sdk/client-s3'), import('@aws-sdk/s3-request-presigner'), this.s3()]);
    // The SDK leaves Content-Type out of the signature unless told otherwise. Signing it means the browser must send exactly this type or R2 refuses the upload.
    return getSignedUrl(client, new PutObjectCommand({ Bucket: this.cfg.bucket, Key: this.full(key), ContentType: contentType }), {
      expiresIn: expiresInSeconds,
      signableHeaders: new Set(['content-type']),
    });
  }

  async head(key: string): Promise<{ size: number } | null> {
    const [{ HeadObjectCommand }, client] = await Promise.all([import('@aws-sdk/client-s3'), this.s3()]);
    try {
      const r = await client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: this.full(key) }));
      return { size: r.ContentLength ?? 0 };
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return null;
      throw err;
    }
  }

  urlFor(key: string): string {
    return `${this.cfg.publicUrl}/${this.full(key)}`;
  }
}

export function r2IsConfigured(cfg: typeof env.r2 = env.r2): boolean {
  return Boolean(cfg.endpoint && cfg.bucket && cfg.accessKeyId && cfg.secretAccessKey && cfg.publicUrl);
}

let override: ObjectStorage | null | undefined;
let instance: ObjectStorage | null | undefined;

/** The configured storage, or null when uploads are not set up. */
export function getStorage(): ObjectStorage | null {
  if (override !== undefined) return override;
  instance ??= r2IsConfigured() ? new R2Storage(env.r2) : null;
  return instance;
}

/** Tests only: use this storage (or null for "not configured") instead of the real one. Pass undefined to go back. */
export function setStorageForTests(storage: ObjectStorage | null | undefined): void {
  override = storage;
}
