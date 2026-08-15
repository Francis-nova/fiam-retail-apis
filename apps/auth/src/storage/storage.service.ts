import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { AuthConfig } from '../config/configuration';

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: Minio.Client;
  private readonly bucket: string;
  private bucketReady = false;

  constructor(configService: ConfigService<AuthConfig, true>) {
    const cfg = configService.get('minio', { infer: true });
    this.bucket = cfg.bucket;
    this.client = new Minio.Client({
      endPoint: cfg.endpoint,
      port: cfg.port,
      useSSL: cfg.useSsl,
      accessKey: cfg.accessKey,
      secretKey: cfg.secretKey,
    });
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketReady) return;
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
        objectKey,
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

  async remove(objectKey: string): Promise<void> {
    await this.client.removeObject(this.bucket, objectKey).catch((err) => {
      this.logger.warn(`MinIO removal failed for ${objectKey}: ${err}`);
    });
  }
}
