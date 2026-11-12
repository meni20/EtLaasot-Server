import { Module } from '@nestjs/common';
import {
  hasExpectedRegistrationConfiguration,
  isVerifiedRailwayDevRuntime,
} from '../parent-registration/registration-environment';
import { SupabaseStorageModule } from '../storage/supabase-storage.module';
import {
  DiscountAdminController,
  DiscountSelfController,
  DiscountRequestGuard,
} from './discount-request.controller';
import { DiscountRequestPdfService } from './discount-request-pdf.service';
import { DiscountRequestRepository } from './discount-request.repository';
import { DiscountRequestService } from './discount-request.service';

@Module({
  imports: [SupabaseStorageModule],
  controllers: [DiscountSelfController, DiscountAdminController],
  providers: [
    DiscountRequestGuard,
    DiscountRequestRepository,
    DiscountRequestPdfService,
    DiscountRequestService,
  ],
})
export class DiscountRequestModule {}

export function discountRequestModules(env = process.env) {
  const railway = Boolean(
    env.RAILWAY_ENVIRONMENT_ID ||
    env.RAILWAY_PROJECT_ID ||
    env.RAILWAY_SERVICE_ID,
  );
  const isDev =
    env.ETLAASOT_RUNTIME_TARGET === 'development' &&
    env.ETLAASOT_GIT_BRANCH === 'dev' &&
    (!railway || isVerifiedRailwayDevRuntime(env));
  return isDev && hasExpectedRegistrationConfiguration(env)
    ? [DiscountRequestModule]
    : [];
}
