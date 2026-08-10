import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { ModelArtifactStorage, ModelArtifactStoragePutInput } from '../../application/ports/model-artifact-storage.port.js';
import type { ModelStorageConfiguration } from '../config/model-storage-configuration.service.js';

export function createS3ModelArtifactStorage(configuration: ModelStorageConfiguration): ModelArtifactStorage {
  const client = new S3Client({
    credentials: {
      accessKeyId: configuration.accessKey,
      secretAccessKey: configuration.secretKey,
    },
    endpoint: configuration.endpoint,
    forcePathStyle: configuration.forcePathStyle,
    region: configuration.region,
  });

  return {
    async getObject(key) {
      const response = await client.send(new GetObjectCommand({ Bucket: configuration.bucket, Key: key }));

      if (!response.Body) {
        throw new Error('O objeto do artefato não possui conteúdo.');
      }

      return new Uint8Array(await response.Body.transformToByteArray());
    },
    async hasObject(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: configuration.bucket, Key: key }));
        return true;
      } catch (error) {
        if (isObjectNotFound(error)) {
          return false;
        }

        throw error;
      }
    },
    async putObject(input) {
      await putObject(client, configuration.bucket, input);
    },
  };
}

async function putObject(client: S3Client, bucket: string, input: ModelArtifactStoragePutInput): Promise<void> {
  await client.send(
    new PutObjectCommand({
      Body: input.body,
      Bucket: bucket,
      ContentType: input.contentType,
      IfNoneMatch: input.ifAbsent ? '*' : undefined,
      Key: input.key,
    }),
  );
}

function isObjectNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const statusCode = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;
  const name = (error as { name?: unknown }).name;

  return statusCode === 404 || name === 'NotFound' || name === 'NoSuchKey';
}
