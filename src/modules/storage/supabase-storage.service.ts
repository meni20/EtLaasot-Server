import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { getOptionalEnv, getRequiredEnv } from 'src/config/env.util';

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);
const DEFAULT_SUPABASE_URL = 'https://tmlnuqrwhdeplpeuuvwv.supabase.co';
const DEFAULT_EVENT_IMAGES_BUCKET = 'event-images';

@Injectable()
export class SupabaseStorageService {
  private client?: SupabaseClient;
  private bucket?: string;
  private publicUrlBase?: string | null;

  public async uploadEventImage(
    eventId: string,
    file: Express.Multer.File,
  ): Promise<string> {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, and WebP images are allowed');
    }

    const client = this.getClient();
    const bucket = this.getBucket();
    const path = this.buildEventImagePath(eventId, file);
    const { error } = await client.storage
      .from(bucket)
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) {
      throw new InternalServerErrorException('Failed to upload event image');
    }

    return path;
  }

  public async deleteEventImage(imagePath?: string | null): Promise<void> {
    if (!imagePath) {
      return;
    }

    const client = this.getClient();
    const bucket = this.getBucket();
    const { error } = await client.storage.from(bucket).remove([imagePath]);

    if (error) {
      throw new InternalServerErrorException('Failed to delete event image');
    }
  }

  public getPublicUrl(imagePath?: string | null): string | null {
    if (!imagePath) {
      return null;
    }

    const publicUrlBase = this.getPublicUrlBase();

    if (!publicUrlBase) {
      return null;
    }

    return `${publicUrlBase}/${this.encodeStoragePath(imagePath)}`;
  }

  private buildEventImagePath(
    eventId: string,
    file: Express.Multer.File,
  ): string {
    const extension = this.getSafeExtension(file);
    return `events/${eventId}/${randomUUID()}${extension}`;
  }

  private getClient(): SupabaseClient {
    if (!this.client) {
      try {
        this.client = createClient(
          getRequiredEnv('SUPABASE_URL'),
          getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
          {
            auth: {
              persistSession: false,
              autoRefreshToken: false,
            },
          },
        );
      } catch {
        throw new InternalServerErrorException(
          'Event image storage is not configured',
        );
      }
    }

    return this.client;
  }

  private getBucket(): string {
    if (!this.bucket) {
      this.bucket = getOptionalEnv(
        'SUPABASE_EVENT_IMAGES_BUCKET',
        DEFAULT_EVENT_IMAGES_BUCKET,
      );
    }

    return this.bucket;
  }

  private getPublicUrlBase(): string | null {
    if (this.publicUrlBase !== undefined) {
      return this.publicUrlBase;
    }

    const supabaseUrl = getOptionalEnv('SUPABASE_URL', DEFAULT_SUPABASE_URL);
    const bucket = this.getBucket();

    if (!supabaseUrl || !bucket) {
      this.publicUrlBase = null;
      return this.publicUrlBase;
    }

    const normalizedSupabaseUrl = supabaseUrl.replace(/\/+$/, '');
    this.publicUrlBase =
      `${normalizedSupabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}`;
    return this.publicUrlBase;
  }

  private encodeStoragePath(imagePath: string): string {
    return imagePath
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
  }

  private getSafeExtension(file: Express.Multer.File): string {
    const originalExtension = extname(file.originalname).toLowerCase();

    if (['.jpg', '.jpeg', '.png', '.webp'].includes(originalExtension)) {
      return originalExtension === '.jpeg' ? '.jpg' : originalExtension;
    }

    switch (file.mimetype) {
      case 'image/jpeg':
        return '.jpg';
      case 'image/png':
        return '.png';
      case 'image/webp':
        return '.webp';
      default:
        return '';
    }
  }
}
