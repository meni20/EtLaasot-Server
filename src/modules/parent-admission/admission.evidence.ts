import { RegistrationIntegrationService } from '../parent-registration/registration-integration.service';
import {
  Injectable,
  Inject,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { RegistrationData } from '../parent-registration/registration.validation';
import type { ApplicationEvidence } from './admission.entities';

// Local contract only. No real Storage/PDF client is installed or invoked here.
// An adapter must verify private bucket status, ownership, byte-sniffed MIME,
// byte size/checksum, malware policy and signed content hash before returning.
// Never accept a storage path, verification flag or PDF status from a browser.
export abstract class AdmissionEvidenceGateway {
  abstract verify(objects: ApplicationEvidence[]): Promise<void>;
  abstract generate(input: {
    applicationId: string;
    versionId: string;
    data: RegistrationData;
    declarations: readonly string[];
    declarationVersion: string;
    templateVersion: string;
  }): Promise<void>;
  abstract availability(): 'UNAVAILABLE' | 'READY';
}
@Injectable()
export class UnavailableAdmissionEvidence extends AdmissionEvidenceGateway {
  availability() {
    return 'UNAVAILABLE' as const;
  }
  async verify(_objects: ApplicationEvidence[]): Promise<void> {
    this.unavailable();
  }
  async generate(
    _input: Parameters<AdmissionEvidenceGateway['generate']>[0],
  ): Promise<void> {
    this.unavailable();
  }
  private unavailable(): never {
    throw new ServiceUnavailableException({
      code: 'REGISTRATION_EVIDENCE_UNAVAILABLE',
      message:
        'Private uploads and signed PDF integration are not available; submission and approval are disabled',
    });
  }
}

@Injectable()
export class IntegratedAdmissionEvidence extends AdmissionEvidenceGateway {
  constructor(
    @Inject(RegistrationIntegrationService)
    private readonly integration: RegistrationIntegrationService,
  ) {
    super();
  }
  availability() {
    return this.integration.enabled()
      ? ('READY' as const)
      : ('UNAVAILABLE' as const);
  }
  async verify(objects: ApplicationEvidence[]) {
    if (!this.integration.enabled())
      throw new ServiceUnavailableException('Private evidence is unavailable');
    await this.integration.verify(objects);
  }
  async generate(input: Parameters<AdmissionEvidenceGateway['generate']>[0]) {
    await this.integration.generate(
      'application',
      input.applicationId,
      input.versionId,
    );
  }
}
