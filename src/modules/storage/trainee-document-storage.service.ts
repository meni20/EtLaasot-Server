import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { isUUID } from 'class-validator';
import { getRequiredEnv } from 'src/config/env.util';
import {
  DocumentType,
  DOCUMENT_MIME_BY_EXTENSION,
  DOCUMENT_URL_TTL_SECONDS,
} from '../trainee-document/trainee-document.constants';

@Injectable()
export class TraineeDocumentStorageService {
  private client?: SupabaseClient;

  private getClient() {
    if (!this.client) {
      try {
        this.client = createClient(
          getRequiredEnv('SUPABASE_URL'),
          getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
          {
            auth: { persistSession: false, autoRefreshToken: false },
          },
        );
      } catch {
        throw new ServiceUnavailableException(
          'Document storage is not configured',
        );
      }
    }
    return this.client;
  }

  private async privateBucket() {
    try {
      const client = this.getClient();
      const bucket = getRequiredEnv('SUPABASE_TRAINEE_DOCUMENTS_BUCKET');
      const { data, error } = await client.storage.getBucket(bucket);
      // Fail closed if an operator accidentally makes this bucket public.
      if (error || !data || data.public !== false) throw new Error();
      return client.storage.from(bucket);
    } catch {
      throw new ServiceUnavailableException(
        'Private document storage is unavailable',
      );
    }
  }

  buildPath(traineeUuid: string, type: DocumentType, extension: string) {
    if (
      !isUUID(traineeUuid, '4') ||
      !Object.values(DocumentType).includes(type) ||
      !DOCUMENT_MIME_BY_EXTENSION[extension]
    ) {
      throw new ServiceUnavailableException('Invalid document storage key');
    }
    return `${traineeUuid}/${type}/${randomUUID()}.${extension}`;
  }

  private assertPath(path: string) {
    const parts = path.split('/');
    const file = parts[2]?.match(/^([0-9a-f-]+)\.(jpg|png|webp|pdf)$/);
    if (
      parts.length !== 3 ||
      !isUUID(parts[0], '4') ||
      !Object.values(DocumentType).includes(parts[1] as DocumentType) ||
      !file ||
      !isUUID(file[1], '4')
    ) {
      throw new ServiceUnavailableException('Invalid document storage key');
    }
  }

  async upload(path: string, buffer: Buffer, mimeType: string) {
    this.assertPath(path);
    try {
      const bucket = await this.privateBucket();
      const { error } = await bucket.upload(path, buffer, {
        contentType: mimeType,
        upsert: false,
        cacheControl: '0',
      });
      if (error) throw new Error();
    } catch {
      throw new ServiceUnavailableException('Failed to upload document');
    }
  }

  async remove(path: string) {
    this.assertPath(path);
    try {
      const bucket = await this.privateBucket();
      const { error } = await bucket.remove([path]);
      if (error) throw new Error();
    } catch {
      throw new ServiceUnavailableException('Failed to remove document');
    }
  }

  async sign(path: string) {
    this.assertPath(path);
    const expiresAt = new Date(
      Date.now() + DOCUMENT_URL_TTL_SECONDS * 1000,
    ).toISOString();
    try {
      const bucket = await this.privateBucket();
      const { data, error } = await bucket.createSignedUrl(
        path,
        DOCUMENT_URL_TTL_SECONDS,
      );
      if (error || !data?.signedUrl) throw new Error();
      return { signedUrl: data.signedUrl, expiresAt };
    } catch {
      throw new ServiceUnavailableException('Failed to open document');
    }
  }
}
