import { RegistrationIntegrationService } from './registration-integration.service';
import { RegistrationFormVersion } from './entities/registration.entities';
import { Injectable } from '@nestjs/common';

// Future adapter receives a committed version ID and must load immutable evidence,
// generate the real PDF, verify private storage/checksum, then attach it transactionally.
// No HTTP, storage SDK, mock PDF, or document-ready mutation is exposed in Phase 2.
export abstract class RegistrationDocumentGenerator {
  abstract availability(): 'DEFERRED' | 'READY';
  abstract requestGeneration(
    versionId: string,
  ): Promise<{ status: 'DEFERRED' | 'READY'; versionId: string }>;
}
@Injectable()
export class DeferredRegistrationDocumentGenerator extends RegistrationDocumentGenerator {
  availability(): 'DEFERRED' {
    return 'DEFERRED';
  }
  requestGeneration(
    versionId: string,
  ): Promise<{ status: 'DEFERRED'; versionId: string }> {
    return Promise.resolve({ status: 'DEFERRED', versionId });
  }
}

@Injectable()
export class IntegratedRegistrationDocumentGenerator extends RegistrationDocumentGenerator {
  constructor(private readonly integration: RegistrationIntegrationService) {
    super();
  }
  availability() {
    return this.integration.enabled()
      ? ('READY' as const)
      : ('DEFERRED' as const);
  }
  async requestGeneration(versionId: string) {
    if (!this.integration.enabled())
      return { status: 'DEFERRED' as const, versionId };
    const version = await RegistrationFormVersion.findByPk(versionId);
    if (!version) throw new Error('Registration version not found');
    return this.integration.generate('renewal', version.formId, versionId);
  }
}
