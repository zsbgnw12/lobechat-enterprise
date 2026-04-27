import {
  BlobSASPermissions,
  BlobServiceClient,
  type ContainerClient,
} from '@azure/storage-blob';
import mime from 'mime';

import { fileEnv } from '@/envs/file';
import { YEAR } from '@/utils/units';

const PRESIGNED_UPLOAD_EXPIRES_IN_SECONDS = 3600;

/**
 * Azure Blob Storage adapter mirroring the surface of the FileS3 client.
 * Activated when AZURE_STORAGE_CONNECTION_STRING is set in env.
 */
export class FileAzureBlob {
  private readonly container: ContainerClient;

  constructor() {
    const connectionString = fileEnv.AZURE_STORAGE_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error(
        'AZURE_STORAGE_CONNECTION_STRING is not set, please check your env',
      );
    }

    const service = BlobServiceClient.fromConnectionString(connectionString);
    this.container = service.getContainerClient(fileEnv.AZURE_STORAGE_CONTAINER);
  }

  async deleteFile(key: string) {
    return this.container.getBlockBlobClient(key).deleteIfExists();
  }

  async deleteFiles(keys: string[]) {
    return Promise.all(keys.map((key) => this.deleteFile(key)));
  }

  async getFileContent(key: string): Promise<string> {
    const buffer = await this.container.getBlockBlobClient(key).downloadToBuffer();
    return buffer.toString('utf8');
  }

  async getFileByteArray(key: string): Promise<Uint8Array> {
    const buffer = await this.container.getBlockBlobClient(key).downloadToBuffer();
    return new Uint8Array(buffer);
  }

  async getFileMetadata(
    key: string,
  ): Promise<{ contentLength: number; contentType?: string }> {
    const props = await this.container.getBlockBlobClient(key).getProperties();
    return {
      contentLength: props.contentLength ?? 0,
      contentType: props.contentType,
    };
  }

  async createPreSignedUrl(key: string): Promise<string> {
    return this.container.getBlockBlobClient(key).generateSasUrl({
      // create + write so PUT can both create and overwrite the blob
      expiresOn: new Date(Date.now() + PRESIGNED_UPLOAD_EXPIRES_IN_SECONDS * 1000),
      permissions: BlobSASPermissions.parse('cw'),
    });
  }

  async createPreSignedUrlForPreview(key: string, expiresIn?: number): Promise<string> {
    const ttl = expiresIn ?? fileEnv.S3_PREVIEW_URL_EXPIRE_IN;
    return this.container.getBlockBlobClient(key).generateSasUrl({
      expiresOn: new Date(Date.now() + ttl * 1000),
      permissions: BlobSASPermissions.parse('r'),
    });
  }

  async uploadBuffer(path: string, buffer: Buffer, contentType?: string, cacheControl?: string) {
    return this.container.getBlockBlobClient(path).uploadData(buffer, {
      blobHTTPHeaders: {
        blobCacheControl: cacheControl,
        blobContentType: contentType,
      },
    });
  }

  async uploadContent(path: string, content: string) {
    const buffer = Buffer.from(content, 'utf8');
    return this.uploadBuffer(path, buffer, 'text/plain');
  }

  async uploadMedia(key: string, buffer: Buffer) {
    const contentType = mime.getType(key) || 'application/octet-stream';
    await this.uploadBuffer(key, buffer, contentType, `public, max-age=${YEAR}`);
  }
}
