import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { SupabaseStorageModule } from '../storage/supabase-storage.module';
import TraineeDocument from './entities/trainee-document.entity';
import { TraineeDocumentController } from './trainee-document.controller';
import { TraineeDocumentAccessGuard } from './trainee-document-access.guard';
import { TraineeDocumentAdminController } from './trainee-document-admin.controller';
import { TraineeDocumentService } from './trainee-document.service';
import { TraineeDocumentRepository } from './trainee-document.repository';

@Module({
  imports: [
    SequelizeModule.forFeature([TraineeDocument]),
    SupabaseStorageModule,
  ],
  controllers: [TraineeDocumentController, TraineeDocumentAdminController],
  providers: [
    TraineeDocumentAccessGuard,
    TraineeDocumentService,
    TraineeDocumentRepository,
  ],
})
export class TraineeDocumentModule {}
