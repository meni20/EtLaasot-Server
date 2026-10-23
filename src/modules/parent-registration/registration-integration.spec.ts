import {
  RegistrationIntegrationService,
  submittedEvidence,
  safeRenderFields,
} from './registration-integration.service';
import { registrationRenderRequest } from './registration-render.contract';
import { fictionalRegistration } from './registration.test-fixtures';
describe('Phase 5 private integration safety (offline)', () => {
  const original = { ...process.env };
  it('records safe Documents field paths without echoing provider bodies or values', () => {
    expect(
      safeRenderFields([
        'parents.parent1.phone',
        'emergencyContact.phone',
        'medical.medications.0.name',
        'secret-value',
        'https://private-provider/key',
        'parents.123456782.phone',
      ]),
    ).toEqual([
      'parents.parent1.phone',
      'emergencyContact.phone',
      'medical.medications.0.name',
    ]);
    expect(safeRenderFields({ phone: 'sensitive-value' })).toEqual([]);
  });
  afterEach(() => {
    process.env = { ...original };
  });
  it('fails closed without explicit local integration configuration before any DB query', async () => {
    delete process.env.PARENT_REGISTRATION_INTEGRATION_ENABLED;
    const db = { query: jest.fn() },
      s = new RegistrationIntegrationService(db as never);
    await expect(s.attest()).rejects.toThrow();
    expect(db.query).not.toHaveBeenCalled();
  });
  it('accepts the verified DEV runtime without a fictional branch allowlist', async () => {
    process.env.PARENT_REGISTRATION_INTEGRATION_ENABLED = 'true';
    process.env.NODE_ENV = 'development';
    process.env.SUPABASE_URL = 'https://vlysppqfozfiwcmsyban.supabase.co';
    process.env.DB_USER = 'etlaasot_app.vlysppqfozfiwcmsyban';
    process.env.DB_SYNC = 'false';
    process.env.DB_LOGGING = 'false';
    delete process.env.RAILWAY_ENVIRONMENT_ID;
    delete process.env.PARENT_REGISTRATION_LOCAL_TEST_BRANCHES;
    const db = { query: jest.fn().mockResolvedValue([{ ok: true }]) };
    const s = new RegistrationIntegrationService(db as never);
    await expect(s.attest()).resolves.toBeUndefined();
    expect(db.query).toHaveBeenCalledTimes(1);
    process.env.NODE_ENV = 'production';
    await expect(s.attest()).rejects.toThrow();
    expect(db.query).toHaveBeenCalledTimes(1);
    process.env.NODE_ENV = 'development';
    process.env.SUPABASE_URL = 'https://tmlnuqrwhdeplpeuuvwv.supabase.co';
    await expect(s.attest()).rejects.toThrow();
    expect(db.query).toHaveBeenCalledTimes(1);
  });
  it('rejects empty and oversized files before decoding or storing bytes', async () => {
    const s = new RegistrationIntegrationService({} as never);
    await expect(
      s.inspect(Buffer.alloc(0), 'PHYSICIAN_SUMMARY'),
    ).rejects.toThrow();
    await expect(
      s.inspect(Buffer.alloc(10 * 1024 * 1024 + 1), 'SIGNATURE'),
    ).rejects.toThrow();
  });
  it('never returns unsent draft attachments to a reviewer', () => {
    const docs = [
      { id: 'draft', versionId: null },
      { id: 'medical', versionId: null },
      { id: 'signature', versionId: null },
      { id: 'pdf', versionId: 'v1' },
      { id: 'foreign-version', versionId: 'v2' },
    ];
    const versions = [
      {
        id: 'v1',
        formData: {
          medical: { physicianSummaryDocumentId: 'medical' },
          signatures: {
            parent1: {
              documentId: 'signature',
              contentHash: 'hash',
              signedAt: 'date',
            },
          },
        },
      },
    ];
    expect(submittedEvidence(docs, versions).map((d) => d.id)).toEqual([
      'medical',
      'signature',
      'pdf',
    ]);
    expect(submittedEvidence(docs, [])).toEqual([]);
  });
  it('maps neutral parents with independent IDs/images/dates and retains all known fields', () => {
    const data = fictionalRegistration(true);
    data.trainee!.siblings = 2;
    const payload = registrationRenderRequest(
      data,
      {
        reference: 'version',
        branch: 'test',
        year: 'year',
        date: '2026-10-22',
      },
      { parent1: 'image-1', parent2: 'image-2' },
    );
    expect(payload.parents.parent1!.nationalId).toBe(data.parent1!.nationalId);
    expect(payload.parents.parent2!.nationalId).toBe(data.parent2!.nationalId);
    expect(payload.signatures.parent1.image).toBe('image-1');
    expect(payload.signatures.parent2!.image).toBe('image-2');
    expect(payload.signatures.parent1.signedAt).toBe(
      data.signatures!.parent1!.signedAt,
    );
    expect(payload.trainee.email).toBe(data.trainee!.email);
    expect(payload.medical.participationRestricted).toBe(
      data.medical!.participationRestricted,
    );
    expect(payload.medical.hasFoodAllergies).toBe(
      data.medical!.hasFoodAllergies,
    );
    expect(payload.trainee.pantsSize).toBe(data.trainee!.pantsSize);
    expect(JSON.stringify(payload)).not.toContain('storagePath');
    expect(JSON.stringify(payload)).not.toContain('sessionToken');
  });
  it('does not invent negative mobility/developmental diagnoses when the source did not collect them', () => {
    const data = fictionalRegistration(false);
    data.medical!.hasToiletingDifficulties = true;
    data.medical!.toiletingDetails = 'Fictional toileting details';
    const payload = registrationRenderRequest(
      data,
      {
        reference: 'version',
        branch: 'test',
        year: 'year',
        date: '2026-10-22',
      },
      { parent1: 'image' },
    );
    expect(payload.medical.mobilityDifficulty).toBeNull();
    expect(payload.medical.toiletingDifficulty).toBe(true);
    expect(payload.developmental.autismPdd).toBeNull();
    expect(payload.developmental.intellectualDisability).toBeNull();
    expect(payload.developmental.other).toContain(data.development!.level);
    expect(payload.signatures.parent2).toBeUndefined();
    expect(payload.parents.parent2).toBeUndefined();
  });
});
