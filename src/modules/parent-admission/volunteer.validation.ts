import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { isEmail, isUUID } from 'class-validator';
import { isValidIsraeliNationalId } from '../user/national-id.util';
import {
  encryptNationalId,
  decryptNationalId,
} from '../user/national-id-encryption.util';
import {
  canonical,
  coveredData,
  reconcileSignatures,
  volunteerIssues,
  VOLUNTEER_PURPOSES,
  needsParent,
  type VolunteerData,
  type VolunteerPurpose,
} from './volunteer.contract';
import { VOLUNTEER_AGREEMENT_VERSION } from './volunteer.legal';

type Rule = string | readonly string[] | { [key: string]: Rule };
const signature = {
  documentId: 'uuid',
  contentHash: 'hash',
  signedAt: 'instant',
  agreementVersion: 'text',
};
const schema: Record<string, Rule> = {
  volunteer: {
    firstName: 'name',
    lastName: 'name',
    nationalId: 'id',
    dateOfBirth: 'date',
    gender: ['male', 'female'],
    address: 'text',
    school: 'text',
    grade: 'text',
    email: 'email',
    phone: 'phone',
    shirtSize: ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'OTHER'],
    customShirtSize: 'text',
    motherName: 'name',
    motherPhone: 'phone',
    motherPhoneNotApplicable: 'boolean',
    fatherName: 'name',
    fatherPhone: 'phone',
    fatherPhoneNotApplicable: 'boolean',
  },
  questionnaire: {
    preference: ['משחקייה', 'חונכות בית', 'אחר'],
    other: 'long',
    age: ['קטן', 'בוגר', 'לא משנה לי'],
    communication: ['מדבר', 'לא מתקשר', 'לא משנה לי'],
    diaper: ['עם טיטול', 'ללא טיטול', 'לא משנה לי'],
    instructionExperience: 'boolean',
    instructionDetails: 'long',
    specialNeedsExperience: 'boolean',
    specialNeedsDetails: 'long',
    motivation: 'long',
  },
  agreements: {
    version: 'text',
    volunteer: 'boolean',
    confidentiality: 'boolean',
  },
  parentConsent: {
    name: 'name',
    nationalId: 'id',
    date: 'date',
    acknowledged: 'boolean',
  },
  policeClearanceDocumentId: 'uuid',
  signatures: Object.fromEntries(VOLUNTEER_PURPOSES.map((p) => [p, signature])),
};
function invalid(path: string): never {
  throw new BadRequestException({
    code: 'VOLUNTEER_VALIDATION',
    field: path,
    message: 'Invalid or incomplete volunteer field',
  });
}
function shape(value: unknown, rule: Rule, path: string, incomplete = true) {
  if (Array.isArray(rule)) {
    if (typeof value !== 'string' || !rule.includes(value)) invalid(path);
    return;
  }
  if (typeof rule === 'object') {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype
    )
      invalid(path);
    for (const [key, child] of Object.entries(value)) {
      if (!Object.hasOwn(rule, key)) invalid(`${path}.${key}`);
      shape(
        child,
        (key === 'motherPhone' &&
          (value as any).motherPhoneNotApplicable === true) ||
          (key === 'fatherPhone' &&
            (value as any).fatherPhoneNotApplicable === true)
          ? 'text'
          : rule[key],
        `${path}.${key}`,
        incomplete,
      );
    }
    return;
  }
  if (rule === 'boolean') {
    if (typeof value !== 'boolean') invalid(path);
    return;
  }
  if (
    typeof value !== 'string' ||
    value.length > (rule === 'long' ? 2000 : rule === 'name' ? 100 : 300) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    invalid(path);
  if (value === '') {
    if (['uuid', 'hash', 'instant'].includes(rule)) invalid(path);
    return;
  }
  if (!incomplete && rule === 'id' && !/^\d{5,9}$/.test(value)) invalid(path);
  if (rule === 'uuid' && !isUUID(value, '4')) invalid(path);
  if (rule === 'hash' && !/^[a-f0-9]{64}$/.test(value)) invalid(path);
  if (!incomplete && rule === 'phone' && !/^[+\d() -]{5,30}$/.test(value))
    invalid(path);
  if (!incomplete && rule === 'email' && !isEmail(value)) invalid(path);
  if (
    rule === 'instant' &&
    (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))
  )
    invalid(path);
  if (
    !incomplete &&
    rule === 'date' &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value)
  )
    invalid(path);
}
export function validateVolunteerDraft(
  data: unknown,
): asserts data is VolunteerData {
  if (Buffer.byteLength(JSON.stringify(data ?? {}), 'utf8') > 96 * 1024)
    invalid('data');
  shape(data, schema, 'data');
}
export const volunteerScopeHash = (
  data: VolunteerData,
  purpose: VolunteerPurpose,
) =>
  createHash('sha256')
    .update(canonical(coveredData(data, purpose, VOLUNTEER_AGREEMENT_VERSION)))
    .digest('hex');
function legacyCoveredData(data: VolunteerData, purpose: VolunteerPurpose) {
  const volunteer = data.volunteer ?? {};
  const identity = {
    firstName: volunteer.firstName,
    lastName: volunteer.lastName,
    nationalId: volunteer.nationalId,
    dateOfBirth: volunteer.dateOfBirth,
  };
  if (purpose === 'VOLUNTEER_AGREEMENT')
    return {
      purpose,
      version: VOLUNTEER_AGREEMENT_VERSION,
      volunteer,
      questionnaire: data.questionnaire,
      acknowledged: data.agreements?.volunteer,
    };
  if (purpose === 'PARENTAL_CONSENT')
    return {
      purpose,
      version: VOLUNTEER_AGREEMENT_VERSION,
      identity,
      parent: data.parentConsent,
    };
  const { signatures, ...content } = data;
  return {
    purpose,
    version: VOLUNTEER_AGREEMENT_VERSION,
    content,
    priorSignatures: {
      VOLUNTEER_AGREEMENT: signatures?.VOLUNTEER_AGREEMENT,
      PARENTAL_CONSENT: signatures?.PARENTAL_CONSENT,
    },
  };
}
export const legacyVolunteerScopeHash = (
  data: VolunteerData,
  purpose: VolunteerPurpose,
) =>
  createHash('sha256')
    .update(canonical(legacyCoveredData(data, purpose)))
    .digest('hex');
export function reconcileVolunteerSignatures(
  previous: VolunteerData,
  next: VolunteerData,
) {
  const copy = reconcileSignatures(previous, next, VOLUNTEER_AGREEMENT_VERSION);
  for (const purpose of VOLUNTEER_PURPOSES) {
    const signing = copy.signatures?.[purpose];
    if (
      signing &&
      signing.contentHash !== volunteerScopeHash(previous, purpose) &&
      (signing.contentHash !== legacyVolunteerScopeHash(previous, purpose) ||
        legacyVolunteerScopeHash(previous, purpose) !==
          legacyVolunteerScopeHash(copy, purpose))
    )
      delete copy.signatures?.[purpose];
  }
  if (copy.signatures && !Object.keys(copy.signatures).length)
    delete copy.signatures;
  return copy;
}
export const volunteerContentHash = (data: VolunteerData) =>
  createHash('sha256').update(canonical(data)).digest('hex');
export function validateVolunteerSubmission(
  data: VolunteerData,
  today?: string,
) {
  if (Buffer.byteLength(JSON.stringify(data ?? {}), 'utf8') > 96 * 1024)
    invalid('data');
  shape(data, schema, 'data', false);
  const issues = volunteerIssues(data, VOLUNTEER_AGREEMENT_VERSION, today);
  if (issues.length) invalid(issues[0].path);
  const birth = data.volunteer!.dateOfBirth!;
  const date =
    today ??
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(
      new Date(),
    );
  if (
    birth > date ||
    Number(date.slice(0, 4)) - Number(birth.slice(0, 4)) > 120
  )
    invalid('volunteer.dateOfBirth');
  if (!isValidIsraeliNationalId(data.volunteer!.nationalId!))
    invalid('volunteer.nationalId');
  if (needsParent(data, date)) {
    if (
      !isValidIsraeliNationalId(data.parentConsent!.nationalId!) ||
      data.parentConsent!.nationalId!.padStart(9, '0') ===
        data.volunteer!.nationalId!.padStart(9, '0')
    )
      invalid('parentConsent.nationalId');
    if (data.parentConsent!.date! > date) invalid('parentConsent.date');
  }
  for (const purpose of VOLUNTEER_PURPOSES) {
    const s = data.signatures?.[purpose];
    if (
      s &&
      (s.agreementVersion !== VOLUNTEER_AGREEMENT_VERSION ||
        (s.contentHash !== volunteerScopeHash(data, purpose) &&
          s.contentHash !== legacyVolunteerScopeHash(data, purpose)))
    )
      invalid(`signatures.${purpose}`);
  }
}
export function protectVolunteerData(
  data: VolunteerData,
  decrypt = false,
): VolunteerData {
  const next = structuredClone(data);
  for (const person of [next.volunteer, next.parentConsent])
    if (person?.nationalId)
      person.nationalId = decrypt
        ? decryptNationalId(person.nationalId)
        : encryptNationalId(person.nationalId);
  return next;
}
export const readVolunteerData = (data: unknown) =>
  protectVolunteerData(data as VolunteerData, true);
