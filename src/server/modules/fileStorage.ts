import { fileEnv } from '@/envs/file';
import { FileAzureBlob } from '@/server/modules/AzureBlob';
import { FileS3 } from '@/server/modules/S3';

/**
 * Structural surface implemented by both FileS3 and FileAzureBlob.
 * Used by call sites that previously instantiated FileS3 directly.
 */
export interface FileStorageClient {
  createPreSignedUrl: (key: string) => Promise<string>;
  createPreSignedUrlForPreview: (key: string, expiresIn?: number) => Promise<string>;
  deleteFile: (key: string) => Promise<unknown>;
  deleteFiles: (keys: string[]) => Promise<unknown>;
  getFileByteArray: (key: string) => Promise<Uint8Array>;
  getFileContent: (key: string) => Promise<string>;
  getFileMetadata: (key: string) => Promise<{ contentLength: number; contentType?: string }>;
  uploadBuffer: (
    path: string,
    buffer: Buffer,
    contentType?: string,
    cacheControl?: string,
  ) => Promise<unknown>;
  uploadContent: (path: string, content: string) => Promise<unknown>;
  uploadMedia: (key: string, buffer: Buffer) => Promise<void>;
}

/**
 * Build the system file-storage client.
 * Picks Azure Blob when AZURE_STORAGE_CONNECTION_STRING is set, else S3.
 * [enterprise-fork]
 */
export const createFileStorageClient = (): FileStorageClient => {
  if (fileEnv.AZURE_STORAGE_CONNECTION_STRING) {
    return new FileAzureBlob();
  }
  return new FileS3();
};
