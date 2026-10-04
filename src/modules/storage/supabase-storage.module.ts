import { Module } from '@nestjs/common';
import { SupabaseStorageService } from './supabase-storage.service';
import { TraineeDocumentStorageService } from './trainee-document-storage.service';

@Module({
  providers: [SupabaseStorageService, TraineeDocumentStorageService],
  exports: [SupabaseStorageService, TraineeDocumentStorageService],
})
export class SupabaseStorageModule {}
