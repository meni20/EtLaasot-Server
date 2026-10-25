import { volunteerApprovedProfileMapping } from './volunteer-profile.mapping';
import {
  volunteerRenderRequest,
  VOLUNTEER_TEMPLATE_VERSION,
} from './volunteer-render.contract';
import { RegistrationIntegrationService } from '../parent-registration/registration-integration.service';
import fs from 'fs';
import path from 'path';
import { randomUUID, randomBytes } from 'crypto';
import {
  needsParent,
  needsClearance,
  reconcileSignatures,
  type VolunteerData,
  type VolunteerPurpose,
} from './volunteer.contract';
import {
  validateVolunteerDraft,
  validateVolunteerSubmission,
  volunteerScopeHash,
  protectVolunteerData,
  readVolunteerData,
} from './volunteer.validation';
import {
  VOLUNTEER_AGREEMENT_VERSION as version,
  VOLUNTEER_LEGAL,
  VOLUNTEER_SOURCE_SHA256,
} from './volunteer.legal';
const person = () => ({
  firstName: 'בדיקה',
  lastName: 'מקומית',
  nationalId: '123456782',
  dateOfBirth: '2000-01-01',
  gender: 'female' as const,
  address: 'כתובת',
  email: 'test@example.invalid',
  phone: '0520000000',
  shirtSize: 'M',
  motherName: 'אם',
  motherPhone: '0500000000',
  fatherName: 'אב',
  fatherPhone: '0500000001',
});
function complete(minor = false): VolunteerData {
  const data: VolunteerData = {
    volunteer: {
      ...person(),
      dateOfBirth: minor ? '2010-01-01' : '2000-01-01',
      school: 'בדיקה',
      grade: 'י',
    },
    questionnaire: {
      preference: 'משחקייה',
      age: 'קטן',
      communication: 'מדבר',
      diaper: 'ללא טיטול',
      instructionExperience: false,
      specialNeedsExperience: false,
      motivation: 'התנדבות',
    },
    agreements: { version, volunteer: true, confidentiality: true },
  };
  if (minor)
    data.parentConsent = {
      name: 'הורה',
      nationalId: '000000018',
      date: '2026-01-01',
      acknowledged: true,
    };
  for (const purpose of [
    'VOLUNTEER_AGREEMENT',
    ...(minor ? ['PARENTAL_CONSENT'] : []),
    'CONFIDENTIALITY',
  ] as VolunteerPurpose[]) {
    data.signatures ??= {};
    data.signatures[purpose] = {
      documentId: randomUUID(),
      signedAt: '2026-01-01T10:00:00.000Z',
      agreementVersion: version,
      contentHash: volunteerScopeHash(data, purpose),
    };
  }
  return data;
}
describe('Volunteer source, validation and independent signing scopes (offline)', () => {
  it('keeps the portable Client contract byte-identical', () => {
    expect(
      fs.readFileSync(
        path.resolve(
          __dirname,
          '../../../../EtLaasot-Client/src/features/volunteer-registration/contracts.ts',
        ),
        'utf8',
      ),
    ).toBe(
      fs.readFileSync(path.join(__dirname, 'volunteer.contract.ts'), 'utf8'),
    );
  });
  it('retains source-specific wording, confidentiality and the original missing question number', () => {
    const template = JSON.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          '../../../../EtLaasot-Documents/templates/volunteer-registration/v1/content.he.json',
        ),
        'utf8',
      ),
    );
    const { sourceChecksum, declarationVersion, ...legal } = template;
    expect(legal).toEqual(VOLUNTEER_LEGAL);
    expect(sourceChecksum).toBe(VOLUNTEER_SOURCE_SHA256);
    expect(declarationVersion).toBe(version);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.resolve(
            __dirname,
            '../../../../EtLaasot-Client/tests/fixtures/volunteer-legal.json',
          ),
          'utf8',
        ),
      ),
    ).toEqual(VOLUNTEER_LEGAL);
    expect(VOLUNTEER_LEGAL.clearance).toBe(
      'חובה לצרף אישור משטרה (לגברים מעל גיל 18)',
    );
    expect(VOLUNTEER_LEGAL.agreement.join(' ')).toContain(
      'השתתפות בקמפיין היא חובה',
    );
    expect(VOLUNTEER_LEGAL.confidentiality.join(' ')).toContain('גם לאחר סיום');
  });
  it('validates partial drafts strictly without accepting arbitrary fields or server-controlled state', () => {
    expect(() =>
      validateVolunteerDraft({ volunteer: { firstName: 'בדיקה' } }),
    ).not.toThrow();
    for (const data of [
      { role: 'ADMIN' },
      { volunteer: { phone: 'invented' } },
      { agreements: { volunteer: 'true' } },
      { signatures: { UNKNOWN: {} } },
    ])
      expect(() => validateVolunteerDraft(data)).toThrow();
  });
  it('accepts complete adult and minor submissions and enforces parental consent on the server', () => {
    expect(() =>
      validateVolunteerSubmission(complete(), '2026-10-25'),
    ).not.toThrow();
    expect(() =>
      validateVolunteerSubmission(complete(true), '2026-10-25'),
    ).not.toThrow();
    const missing = complete(true);
    delete missing.signatures!.PARENTAL_CONSENT;
    expect(() => validateVolunteerSubmission(missing, '2026-10-25')).toThrow();
    const self = complete(true);
    self.parentConsent!.nationalId = self.volunteer!.nationalId;
    expect(() => validateVolunteerSubmission(self, '2026-10-25')).toThrow();
  });
  it('uses Jerusalem dates and exact age boundaries without expanding police-clearance applicability', () => {
    const data: VolunteerData = {
      volunteer: { dateOfBirth: '2008-10-25', gender: 'male' },
    };
    expect(needsParent(data, '2026-10-24')).toBe(true);
    expect(needsParent(data, '2026-10-25')).toBe(false);
    expect(needsClearance(data, '2026-10-25')).toBe(false);
    expect(needsClearance(data, '2026-10-26')).toBe(true);
    data.volunteer!.gender = 'female';
    expect(needsClearance(data, '2026-10-26')).toBe(false);
  });
  it('retains unaffected signatures and renews the final signature after earlier attestations or evidence change', () => {
    const data = complete(true);
    const preference = structuredClone(data);
    preference.questionnaire!.motivation = 'שינוי';
    const a = reconcileSignatures(data, preference, version);
    expect(a.signatures!.VOLUNTEER_AGREEMENT).toBeUndefined();
    expect(a.signatures!.PARENTAL_CONSENT).toEqual(
      data.signatures!.PARENTAL_CONSENT,
    );
    expect(a.signatures!.CONFIDENTIALITY).toBeUndefined();
    const parent = structuredClone(data);
    parent.parentConsent!.name = 'אחר';
    const b = reconcileSignatures(data, parent, version);
    expect(b.signatures!.VOLUNTEER_AGREEMENT).toEqual(
      data.signatures!.VOLUNTEER_AGREEMENT,
    );
    expect(b.signatures!.PARENTAL_CONSENT).toBeUndefined();
    expect(b.signatures!.CONFIDENTIALITY).toBeUndefined();
    const upload = structuredClone(data);
    upload.policeClearanceDocumentId = randomUUID();
    const c = reconcileSignatures(data, upload, version);
    expect(c.signatures!.VOLUNTEER_AGREEMENT).toBeDefined();
    expect(c.signatures!.CONFIDENTIALITY).toBeUndefined();
  });
  it('rejects forged hashes, unknown versions, future dates and missing required clearance', () => {
    const data = complete();
    data.signatures!.CONFIDENTIALITY!.contentHash = 'a'.repeat(64);
    expect(() => validateVolunteerSubmission(data, '2026-10-25')).toThrow();
    const stale = complete();
    stale.agreements!.version = 'unknown';
    expect(() => validateVolunteerSubmission(stale, '2026-10-25')).toThrow();
    const male = complete();
    male.volunteer!.gender = 'male';
    expect(() => validateVolunteerSubmission(male, '2026-10-25')).toThrow();
    const future = complete();
    future.volunteer!.dateOfBirth = '2090-01-01';
    expect(() => validateVolunteerSubmission(future, '2026-10-25')).toThrow();
  });
  it('encrypts applicant and parent IDs at rest without changing signing scopes after read', () => {
    const previous = process.env.NATIONAL_ID_ENCRYPTION_KEY;
    process.env.NATIONAL_ID_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    try {
      const data = complete(true),
        stored = protectVolunteerData(data);
      expect(stored.volunteer!.nationalId).not.toContain('123456782');
      expect(stored.parentConsent!.nationalId).not.toContain('000000018');
      expect(readVolunteerData(stored)).toEqual(data);
    } finally {
      if (previous === undefined) delete process.env.NATIONAL_ID_ENCRYPTION_KEY;
      else process.env.NATIONAL_ID_ENCRYPTION_KEY = previous;
    }
  });
  it('sniffs real private upload bytes and rejects spoofed content and oversized files', async () => {
    const integration = new RegistrationIntegrationService({} as never);
    const bytes = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../../EtLaasot-Documents/mock/signature.png',
      ),
    );
    await expect(
      integration.inspect(bytes, 'POLICE_CLEARANCE'),
    ).resolves.toMatchObject({ mimeType: 'image/png' });
    await expect(
      integration.inspect(
        Buffer.from('<html>fake.pdf</html>'),
        'POLICE_CLEARANCE',
      ),
    ).rejects.toThrow();
    await expect(
      integration.inspect(
        Buffer.alloc(10 * 1024 * 1024 + 1),
        'POLICE_CLEARANCE',
      ),
    ).rejects.toThrow();
  });
  it('preserves Phase 2 drafts but requires the new personal phone for submission', () => {
    const data = complete();
    delete data.volunteer!.phone;
    expect(() => validateVolunteerDraft(data)).not.toThrow();
    expect(() => validateVolunteerSubmission(data, '2026-10-25')).toThrow();
    data.volunteer!.phone = 'invalid';
    expect(() => validateVolunteerDraft(data)).toThrow();
  });
  it('maps every submitted field and only the personal phone to the future profile', () => {
    const data = complete(true),
      images = {
        VOLUNTEER_AGREEMENT: 'data:image/png;base64,fictional',
        PARENTAL_CONSENT: 'data:image/png;base64,fictional',
        CONFIDENTIALITY: 'data:image/png;base64,fictional',
      };
    data.policeClearanceDocumentId = randomUUID();
    // Reset confidentiality hash after the additional reference.
    data.signatures!.CONFIDENTIALITY!.contentHash = volunteerScopeHash(
      data,
      'CONFIDENTIALITY',
    );
    const meta = {
      reference: randomUUID(),
      applicationId: randomUUID(),
      branch: 'branch-a',
      submittedAt: '2026-10-25T10:00:00.000Z',
    };
    const mapped = volunteerRenderRequest(data, meta, images);
    expect(mapped.volunteer).toEqual(data.volunteer);
    expect(mapped.questionnaire).toEqual(data.questionnaire);
    expect(mapped.parentConsent).toEqual(data.parentConsent);
    expect(mapped.registration).toEqual(meta);
    expect(mapped).not.toHaveProperty('policeClearanceDocumentId');
    expect(mapped.version).toBe('v1');
    expect(VOLUNTEER_TEMPLATE_VERSION).toBe('volunteer-registration/v1');
    expect(volunteerApprovedProfileMapping(data).phoneNumber).toBe(
      '0520000000',
    );
    expect(volunteerApprovedProfileMapping(data).phoneNumber).not.toBe(
      data.volunteer!.motherPhone,
    );
  });
});
