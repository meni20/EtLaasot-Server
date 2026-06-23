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
  private readonly client: SupabaseClient;
  private readonly bucket: string;

  constructor() {
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
    this.bucket = getRequiredEnv('SUPABASE_EVENT_IMAGES_BUCKET');
  }

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

    const path = this.buildEventImagePath(eventId, file);
    const { error } = await this.client.storage
      .from(this.bucket)
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

    const { error } = await this.client.storage
      .from(this.bucket)
      .remove([imagePath]);

    if (error) {
      throw new InternalServerErrorException('Failed to delete event image');
    }
  }

  public getPublicUrl(imagePath?: string | null): string | null {
    if (!imagePath) {
      return null;
    }

    const { data } = this.client.storage
      .from(this.bucket)
      .getPublicUrl(imagePath);

    return data.publicUrl;
  }

  private buildEventImagePath(
    eventId: string,
    file: Express.Multer.File,
  ): string {
    const extension = this.getSafeExtension(file);
    return `events/${eventId}/${randomUUID()}${extension}`;
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
