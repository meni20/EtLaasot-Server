import { Injectable } from '@nestjs/common';

// Future adapter receives a committed version ID and must load immutable evidence,
// generate the real PDF, verify private storage/checksum, then attach it transactionally.
// No HTTP, storage SDK, mock PDF, or document-ready mutation is exposed in Phase 2.
export abstract class RegistrationDocumentGenerator {
  abstract availability(): 'DEFERRED';
  abstract requestGeneration(
    versionId: string,
  ): Promise<{ status: 'DEFERRED'; versionId: string }>;
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
