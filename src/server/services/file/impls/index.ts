import { type LobeChatDatabase } from '@lobechat/database';

import { fileEnv } from '@/envs/file';

import { AzureBlobStaticFileImpl } from './azureBlob';
import { S3StaticFileImpl } from './s3';
import { type FileServiceImpl } from './type';

/**
 * Create file service module.
 * - If AZURE_STORAGE_CONNECTION_STRING is set → use Azure Blob.
 * - Otherwise → use S3 (or S3-compatible).
 */
export const createFileServiceModule = (db: LobeChatDatabase): FileServiceImpl => {
  if (fileEnv.AZURE_STORAGE_CONNECTION_STRING) {
    return new AzureBlobStaticFileImpl(db);
  }
  return new S3StaticFileImpl(db);
};
