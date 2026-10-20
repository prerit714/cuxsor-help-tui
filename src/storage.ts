import { randomUUID } from 'node:crypto';
import { BlobServiceClient, RestError, type ContainerClient } from '@azure/storage-blob';

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export type ImageInfo = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
};

export class ImageError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Image ids are `img__<uuid>`. The prefix is deliberate: it is the token a client-side skill
 * keys on to know that a string in the conversation refers to an uploaded image.
 */
export const IMAGE_ID_PREFIX = 'img__';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const IMAGE_ID_RE = new RegExp(`^${IMAGE_ID_PREFIX}${UUID}$`, 'i');
const BARE_UUID_RE = new RegExp(`^${UUID}$`, 'i');

export function newImageId(): string {
  return IMAGE_ID_PREFIX + randomUUID();
}

export function isImageId(id: string): boolean {
  return IMAGE_ID_RE.test(id);
}

/** Canonical id, or null. Tolerates surrounding whitespace and a bare UUID (adds the prefix). */
export function normalizeImageId(raw: string): string | null {
  const s = raw.trim();
  if (isImageId(s)) return s.toLowerCase();
  if (BARE_UUID_RE.test(s)) return IMAGE_ID_PREFIX + s.toLowerCase();
  return null;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Detects the image type from magic bytes; the client-declared MIME type is never trusted. */
export function sniffImageMime(buf: Buffer): ImageMime | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'image/gif';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP')
    return 'image/webp';
  return null;
}

/**
 * Image persistence on Azure Blob Storage (Azurite locally).
 * The blob name *is* the image UUID handed to MCP clients.
 */
export class ImageStore {
  private readonly container: ContainerClient;

  constructor(connectionString: string, containerName: string) {
    // Storage is local; fail fast instead of the SDK's default multi-minute retry backoff.
    this.container = BlobServiceClient.fromConnectionString(connectionString, {
      retryOptions: { maxTries: 2, retryDelayInMs: 200, maxRetryDelayInMs: 1000 },
    }).getContainerClient(containerName);
  }

  async ensureContainer(): Promise<void> {
    await this.container.createIfNotExists();
  }

  /** True when storage is reachable; also (re)creates the container, so a nuked Azurite heals here. */
  async ping(): Promise<boolean> {
    try {
      await this.container.createIfNotExists({ abortSignal: AbortSignal.timeout(1500) });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Runs a blob operation, recreating the container and retrying once if it has vanished
   * (e.g. after `npm run azurite:nuke` while the server is running).
   */
  private async withContainer<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (!isContainerNotFound(err)) throw err;
      await this.ensureContainer();
      return await op();
    }
  }

  async put(data: Buffer, filename = 'image'): Promise<ImageInfo> {
    const mimeType = sniffImageMime(data);
    if (!mimeType) throw new ImageError('Unsupported file: only PNG, JPEG, GIF and WebP images are accepted', 415);
    const id = newImageId();
    const uploadedAt = new Date().toISOString();
    await this.withContainer(() =>
      this.container.getBlockBlobClient(id).uploadData(data, {
        blobHTTPHeaders: { blobContentType: mimeType },
        // Metadata values travel as HTTP headers, so keep them ASCII.
        metadata: { originalname: encodeURIComponent(filename), uploadedat: uploadedAt },
      }),
    );
    return { id, filename, mimeType, size: data.length, uploadedAt };
  }

  async get(rawId: string): Promise<{ info: ImageInfo; data: Buffer } | null> {
    const id = normalizeImageId(rawId);
    if (!id) throw new ImageError(`Invalid image id: ${rawId} (expected img__<uuid>)`, 400);
    const blob = this.container.getBlobClient(id);
    return this.withContainer(async () => {
      try {
        const props = await blob.getProperties();
        const data = await blob.downloadToBuffer();
        return {
          data,
          info: {
            id,
            filename: decodeName(props.metadata?.originalname),
            mimeType: props.contentType ?? 'application/octet-stream',
            size: data.length,
            uploadedAt: props.metadata?.uploadedat ?? props.createdOn?.toISOString() ?? '',
          },
        };
      } catch (err) {
        // A missing blob is a normal miss; a missing container is left for withContainer to repair.
        if (err instanceof RestError && err.statusCode === 404 && !isContainerNotFound(err)) return null;
        throw err;
      }
    });
  }

  /** Newest first. Lists the whole container then sorts, which is fine for a local, personal store. */
  async list(limit = 50): Promise<ImageInfo[]> {
    const out: ImageInfo[] = [];
    await this.withContainer(async () => {
      out.length = 0;
      for await (const b of this.container.listBlobsFlat({ includeMetadata: true })) {
        if (!isImageId(b.name)) continue;
        out.push({
          id: b.name,
          filename: decodeName(b.metadata?.originalname),
          mimeType: b.properties.contentType ?? 'application/octet-stream',
          size: b.properties.contentLength ?? 0,
          uploadedAt: b.metadata?.uploadedat ?? b.properties.createdOn?.toISOString() ?? '',
        });
      }
    });
    out.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    return out.slice(0, limit);
  }

  async delete(rawId: string): Promise<boolean> {
    const id = normalizeImageId(rawId);
    if (!id) throw new ImageError(`Invalid image id: ${rawId} (expected img__<uuid>)`, 400);
    const res = await this.container.getBlobClient(id).deleteIfExists();
    return res.succeeded;
  }

  /** Drops the whole container (used by tests). */
  async destroy(): Promise<void> {
    await this.container.deleteIfExists();
  }
}

function isContainerNotFound(err: unknown): boolean {
  if (!(err instanceof RestError)) return false;
  const code = err.code ?? (err.details as { errorCode?: string } | undefined)?.errorCode;
  return err.statusCode === 404 && code === 'ContainerNotFound';
}

function decodeName(raw: string | undefined): string {
  if (!raw) return 'image';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
