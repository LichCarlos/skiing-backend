import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { setTimeout } from 'node:timers/promises';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
  type BucketLocationConstraint,
} from '@aws-sdk/client-s3';

if (existsSync('.env')) loadEnvFile('.env');
const required = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is required`);
  return value;
};
const bucket = required('S3_BUCKET'),
  region = process.env.S3_REGION?.trim() || 'us-east-1';
const client = new S3Client({
  endpoint: required('S3_ENDPOINT'),
  region,
  forcePathStyle: true,
  maxAttempts: 1,
  credentials: {
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
  },
  requestHandler: { connectionTimeout: 3000, requestTimeout: 5000 },
});
async function initialize() {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    if (status !== 404) throw error;
    try {
      await client.send(
        new CreateBucketCommand({
          Bucket: bucket,
          ...(region === 'us-east-1'
            ? {}
            : {
                CreateBucketConfiguration: {
                  LocationConstraint: region as BucketLocationConstraint,
                },
              }),
        }),
      );
    } catch (createError) {
      if ((createError as { name?: string }).name !== 'BucketAlreadyOwnedByYou')
        throw createError;
    }
  }
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
}
try {
  for (let attempt = 1; ; attempt++) {
    try {
      await initialize();
      break;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (attempt >= 15 || (status !== undefined && status < 500)) throw error;
      await setTimeout(1000);
    }
  }
  console.log(
    'Asset bucket is available; existing access policies were preserved.',
  );
} finally {
  client.destroy();
}
