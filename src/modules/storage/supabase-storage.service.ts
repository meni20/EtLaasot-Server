import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { getRequiredEnv } from 'src/config/env.util';

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

@Injectable()
export class SupabaseStorageService {
  private client?: SupabaseClient;
  private bucket?: string;

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
    const { error } = await client.storage
      .from(bucket)
      .remove([imagePath]);

    if (error) {
      throw new InternalServerErrorException('Failed to delete event image');
    }
  }

  public getPublicUrl(imagePath?: string | null): string | null {
    if (!imagePath) {
      return null;
    }

    try {
      const client = this.getClient();
      const bucket = this.getBucket();
      const { data } = client.storage
        .from(bucket)
        .getPublicUrl(imagePath);

      return data.publicUrl;
    } catch {
      return null;
    }
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
      try {
        this.bucket = getRequiredEnv('SUPABASE_EVENT_IMAGES_BUCKET');
      } catch {
        throw new InternalServerErrorException(
          'Event image storage is not configured',
        );
      }
    }

    return this.bucket;
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
