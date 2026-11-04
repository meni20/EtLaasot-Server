import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { WebSocketLikeConstructor } from '@supabase/realtime-js';
import WebSocket from 'ws';
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
// Supabase Realtime is initialized with the client even though this service
// only uses Storage. Node 20 has no native WebSocket, so provide the server
// transport explicitly instead of relying on the host runtime.
const NODE_WEBSOCKET_TRANSPORT =
  WebSocket as unknown as WebSocketLikeConstructor;

@Injectable()
export class SupabaseStorageService {
  private readonly logger = new Logger(SupabaseStorageService.name);
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
      throw new BadRequestException(
        'Only JPEG, PNG, and WebP images are allowed',
      );
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
      this.logStorageFailure('event-image-upload', error);
      throw new InternalServerErrorException('Failed to upload event image');
    }

    return path;
  }

  public async uploadCalendarMonthBackground(
    branchId: string,
    monthKey: string,
    file: Express.Multer.File,
  ): Promise<string> {
    if (!file) {
      throw new BadRequestException('Image file is required');
    }

    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        'Only JPEG, PNG, and WebP images are allowed',
      );
    }

    const path = this.buildCalendarMonthBackgroundPath(
      branchId,
      monthKey,
      file,
    );
    const client = this.getClient();
    const bucket = this.getBucket();

    const { error } = await client.storage
      .from(bucket)
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });

    if (error) {
      this.logStorageFailure('calendar-background-upload', error);
      throw new InternalServerErrorException(
        'Failed to upload calendar background image',
      );
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
      this.logStorageFailure('event-image-delete', error);
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

  private buildCalendarMonthBackgroundPath(
    branchId: string,
    monthKey: string,
    file: Express.Multer.File,
  ): string {
    const extension = this.getSafeExtension(file);

    return `calendar-backgrounds/${branchId}/${monthKey}/${randomUUID()}${extension}`;
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
            realtime: {
              transport: NODE_WEBSOCKET_TRANSPORT,
            },
          },
        );
      } catch (error) {
        this.logStorageFailure('client-initialization', error);
        throw new InternalServerErrorException(
          'Event image storage is not configured',
        );
      }
    }

    return this.client;
  }

  private getBucket(): string {
    if (!this.bucket) {
      this.bucket =
        getOptionalEnv('SUPABASE_EVENT_IMAGES_BUCKET') ??
        DEFAULT_EVENT_IMAGES_BUCKET;
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

    this.publicUrlBase = `${normalizedSupabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}`;

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

  private logStorageFailure(stage: string, error: unknown): void {
    const record =
      error && typeof error === 'object'
        ? (error as Record<string, unknown>)
        : undefined;
    const name =
      error instanceof Error
        ? error.name
        : typeof record?.name === 'string'
          ? record.name
          : 'UnknownError';
    const category = [
      'Error',
      'TypeError',
      'StorageError',
      'StorageApiError',
      'StorageUnknownError',
    ].includes(name)
      ? name
      : 'UnknownError';
    const rawStatus = String(record?.statusCode ?? record?.status ?? '');
    const status = /^[1-5]\d{2}$/.test(rawStatus) ? rawStatus : 'none';

    this.logger.error(
      `Event image storage failure: stage=${stage} category=${category} status=${status}`,
    );
  }
}
