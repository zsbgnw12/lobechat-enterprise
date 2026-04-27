import { type LobeChatDatabase } from '@lobechat/database';

import { FileModel } from '@/database/models/file';
import { FileAzureBlob } from '@/server/modules/AzureBlob';

import { type FileServiceImpl } from './type';

/**
 * Azure Blob Storage file service implementation.
 * Mirrors S3StaticFileImpl. Activated via AZURE_STORAGE_CONNECTION_STRING.
 */
export class AzureBlobStaticFileImpl implements FileServiceImpl {
  private readonly blob: FileAzureBlob;
  private readonly db: LobeChatDatabase;

  constructor(db: LobeChatDatabase) {
    this.db = db;
    this.blob = new FileAzureBlob();
  }

  async deleteFile(key: string) {
    return this.blob.deleteFile(key);
  }

  async deleteFiles(keys: string[]) {
    return this.blob.deleteFiles(keys);
  }

  async getFileContent(key: string): Promise<string> {
    return this.blob.getFileContent(key);
  }

  async getFileByteArray(key: string): Promise<Uint8Array> {
    return this.blob.getFileByteArray(key);
  }

  async createPreSignedUrl(key: string): Promise<string> {
    return this.blob.createPreSignedUrl(key);
  }

  async getFileMetadata(key: string): Promise<{ contentLength: number; contentType?: string }> {
    return this.blob.getFileMetadata(key);
  }

  async createPreSignedUrlForPreview(key: string, expiresIn?: number): Promise<string> {
    return this.blob.createPreSignedUrlForPreview(key, expiresIn);
  }

  async uploadContent(path: string, content: string) {
    return this.blob.uploadContent(path, content);
  }

  async getFullFileUrl(url?: string | null, expiresIn?: number): Promise<string> {
    if (!url) return '';

    let key = url;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const extractedKey = await this.getKeyFromFullUrl(url);
      if (!extractedKey) {
        throw new Error('Key not found from url: ' + url);
      }
      key = extractedKey;
    }

    return this.createPreSignedUrlForPreview(key, expiresIn);
  }

  async getKeyFromFullUrl(url: string): Promise<string | null> {
    try {
      const urlObject = new URL(url);
      const { pathname } = urlObject;

      // File proxy URL pattern /f/{fileId} → look up DB
      if (pathname.startsWith('/f/')) {
        const fileId = pathname.slice(3);
        const file = await FileModel.getFileById(this.db, fileId);
        return file?.url ?? null;
      }

      // Azure Blob virtual hosting style:
      //   https://<account>.blob.core.windows.net/<container>/<key>
      // pathname starts with /<container>/, strip it.
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length >= 2) {
        return segments.slice(1).join('/');
      }
      return pathname.startsWith('/') ? pathname.slice(1) : pathname;
    } catch {
      return null;
    }
  }

  async uploadMedia(key: string, buffer: Buffer): Promise<{ key: string }> {
    await this.blob.uploadMedia(key, buffer);
    return { key };
  }

  async uploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<{ key: string }> {
    await this.blob.uploadBuffer(key, buffer, contentType);
    return { key };
  }
}
