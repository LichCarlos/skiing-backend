import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { AssetStorage } from '../application/ports/asset-storage.js';

@Injectable()
export class S3AssetStorage implements AssetStorage {
  async put(input: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void> {
    const abortSignal = this.requestSignal();
    const { client, bucket } = this.configuration();
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          ServerSideEncryption:
            process.env.S3_SERVER_SIDE_ENCRYPTION === 'true'
              ? 'AES256'
              : undefined,
        }),
        { abortSignal },
      );
    } finally {
      client.destroy();
    }
  }

  async remove(key: string): Promise<void> {
    const abortSignal = this.requestSignal();
    const { client, bucket } = this.configuration();
    try {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }), {
        abortSignal,
      });
    } finally {
      client.destroy();
    }
  }

  async createReadUrl(key: string, expiresInSeconds: number): Promise<string> {
    const { bucket, region, accessKeyId, secretAccessKey, endpoint } =
      this.configurationValues();
    const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT?.trim() || endpoint;
    const signer = this.createClient({
      region,
      accessKeyId,
      secretAccessKey,
      endpoint: publicEndpoint,
    });
    try {
      return await getSignedUrl(
        signer,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: expiresInSeconds },
      );
    } finally {
      signer.destroy();
    }
  }

  private requestSignal(): AbortSignal {
    const timeout = Number(process.env.S3_REQUEST_TIMEOUT_MS ?? 30_000);
    if (
      !Number.isSafeInteger(timeout) ||
      timeout < 1 ||
      timeout > 2_147_483_647
    ) {
      throw new ServiceUnavailableException(
        'S3_REQUEST_TIMEOUT_MS must be an integer between 1 and 2147483647',
      );
    }
    // Socket inactivity timeouts alone do not bound a trickling response.
    // SDK retries are disabled below: their backoff is not abortable.
    return AbortSignal.timeout(timeout);
  }

  private configuration() {
    const values = this.configurationValues();
    return { client: this.createClient(values), bucket: values.bucket };
  }

  private configurationValues() {
    const endpoint = process.env.S3_ENDPOINT?.trim();
    const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
    const bucket = process.env.S3_BUCKET?.trim();
    const missing = [
      !endpoint && 'S3_ENDPOINT',
      !accessKeyId && 'S3_ACCESS_KEY_ID',
      !secretAccessKey && 'S3_SECRET_ACCESS_KEY',
      !bucket && 'S3_BUCKET',
    ].filter(Boolean);
    if (missing.length) {
      throw new ServiceUnavailableException(
        `Asset storage configuration is missing: ${missing.join(', ')}`,
      );
    }
    return {
      endpoint: endpoint!,
      accessKeyId: accessKeyId!,
      secretAccessKey: secretAccessKey!,
      bucket: bucket!,
      region: process.env.S3_REGION?.trim() || 'us-east-1',
    };
  }

  private createClient(input: {
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint: string;
  }): S3Client {
    return new S3Client({
      region: input.region,
      endpoint: input.endpoint,
      forcePathStyle: true,
      maxAttempts: 1,
      credentials: {
        accessKeyId: input.accessKeyId,
        secretAccessKey: input.secretAccessKey,
      },
    });
  }
}
