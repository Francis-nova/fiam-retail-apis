import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import type { Readable } from 'stream';
import { AuthConfig } from '../config/configuration';

// "fiam-staging", "/fiam-staging/" and "fiam-staging/" all mean the same folder;
// blank means the bucket root. Never starts with "/", always ends with "/".
export function normalizePrefix(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/^\/+|\/+$/g, '');
  return trimmed ? `${trimmed}/` : '';
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: Minio.Client;
  private readonly bucket: string;
  private readonly autoCreate: boolean;
  private readonly prefix: string;
  private bucketReady = false;

  constructor(configService: ConfigService<AuthConfig, true>) {
    const cfg = configService.get('minio', { infer: true });
    this.bucket = cfg.bucket;
    this.autoCreate = cfg.autoCreateBucket;
    this.prefix = normalizePrefix(cfg.keyPrefix);
    // External object storage is shared between environments (and with other
    // company data), separated only by folder. A blank folder there would write
    // into the bucket root, so refuse to start rather than risk it. A local
    // MinIO (host "minio"/"localhost") owns its whole bucket and is exempt.
    const local = ['minio', 'localhost', '127.0.0.1'].includes(cfg.endpoint);
    if (!local && !this.prefix && !cfg.allowBucketRoot) {
      throw new Error(
        'MINIO_KEY_PREFIX must be set for external object storage (e.g. "fiam-staging/" or "fiam-production/"). Set MINIO_ALLOW_BUCKET_ROOT=true only for a bucket dedicated to this app.',
      );
    }
    this.client = new Minio.Client({
      endPoint: cfg.endpoint,
      port: cfg.port,
      useSSL: cfg.useSsl,
      accessKey: cfg.accessKey,
      secretKey: cfg.secretKey,
      ...(cfg.region ? { region: cfg.region } : {}),
    });
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
    // Managed object storage: the bucket exists already and our key may not
    // be allowed to list or create buckets, so don't try.
    if (!this.autoCreate) {
      this.bucketReady = true;
      return;
    }
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
    this.bucketReady = true;
  }

  async upload(
    objectKey: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    try {
      await this.ensureBucket();
      await this.client.putObject(
        this.bucket,
        this.prefix + objectKey,
        buffer,
        buffer.length,
        {
          'Content-Type': mimeType,
        },
      );
    } catch (err) {
      this.logger.error(`MinIO upload failed for ${objectKey}`, err as Error);
      throw new ServiceUnavailableException(
        'File storage is currently unavailable',
      );
    }
  }

  // Streams an object back — used by the admin console's document viewer,
  // which reaches files through the service instead of exposing MinIO.
  async getObject(objectKey: string): Promise<Readable> {
    try {
      await this.ensureBucket();
      return await this.client.getObject(this.bucket, this.prefix + objectKey);
    } catch (err) {
      this.logger.error(`MinIO read failed for ${objectKey}`, err as Error);
      throw new ServiceUnavailableException(
        'File storage is currently unavailable',
      );
    }
  }

  async remove(objectKey: string): Promise<void> {
    await this.client
      .removeObject(this.bucket, this.prefix + objectKey)
      .catch((err) => {
        this.logger.warn(`MinIO removal failed for ${objectKey}: ${err}`);
      });
  }
}
