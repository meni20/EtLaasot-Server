import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';
import { isEmail, isISO8601, isUUID } from 'class-validator';
import { DECLARATION_VERSION } from './declarations';
import {
  decryptNationalId,
  encryptNationalId,
} from '../user/national-id-encryption.util';
import {
  isValidIsraeliNationalId,
  normalizeIsraeliNationalId,
} from '../user/national-id.util';
import type { ShirtSize } from '../user/interfaces/user.interface';

export type Person = {
  name?: string;
  nationalId?: string;
  phone?: string;
  email?: string;
  occupation?: string;
  dateOfBirth?: string;
};
export type Signature = {
  documentId: string;
  contentHash: string;
  signedAt: string;
};
export interface RegistrationData {
  trainee?: Person & {
    familyName?: string;
    nickname?: string;
    address?: string;
    gender?: 'male' | 'female';
    healthFund?: string;
    siblings?: number;
    school?: string;
    shirtSize?: ShirtSize;
    customShirtSize?: string;
    pantsSize?: string;
  };
  parent1?: Person;
  parent2?: Person;
  contacts?: {
    familyStatus?: string;
    emergencyName?: string;
    emergencyRelationship?: string;
    emergencyPhone?: string;
    schoolPhone?: string;
    schoolCounselor?: string;
    schoolCounselorPhone?: string;
  };
  medical?: {
    hasConditions?: boolean;
    conditions?: string[];
    participationRestricted?: boolean;
    restrictionDetails?: string;
    takesMedication?: boolean;
    medications?: {
      name: string;
      dosage?: string;
      frequency?: string;
      instructions?: string;
    }[];
    hasFoodAllergies?: boolean;
    allergies?: string;
    eatsIndependently?: boolean;
    hasToiletingDifficulties?: boolean;
    toiletingDetails?: string;
    usesDiapers?: boolean;
    physicianName?: string;
    physicianHealthFund?: string;
    physicianPhone?: string;
    physicianSummaryDocumentId?: string;
  };
  development?: { level?: string; details?: string };
  declarationVersion?: string;
  declarationAcceptances?: boolean[];
  signatures?: { parent1?: Signature; parent2?: Signature };
}

// Payloads contain references to completed private assets, never strokes or binaries.
type Rule = string | { [key: string]: Rule } | readonly [Rule];
const person = {
  name: 'name',
  nationalId: 'id',
  phone: 'phone',
  email: 'email',
  occupation: 'text',
  dateOfBirth: 'date',
};
const signature = {
  documentId: 'uuid',
  contentHash: 'hash',
  signedAt: 'instant',
};
const schema: Record<string, Rule> = {
  trainee: {
    ...person,
    familyName: 'name',
    nickname: 'text',
    address: 'address',
    gender: 'gender',
    healthFund: 'text',
    siblings: 'count',
    school: 'text',
    shirtSize: 'shirt',
    customShirtSize: 'size',
    pantsSize: 'text',
  },
  parent1: person,
  parent2: person,
  contacts: {
    familyStatus: 'text',
    emergencyName: 'text',
    emergencyRelationship: 'text',
    emergencyPhone: 'phone',
    schoolPhone: 'phone',
    schoolCounselor: 'text',
    schoolCounselorPhone: 'phone',
  },
  medical: {
    hasConditions: 'bool',
    conditions: ['text'],
    participationRestricted: 'bool',
    restrictionDetails: 'long',
    takesMedication: 'bool',
    medications: [
      { name: 'text', dosage: 'text', frequency: 'text', instructions: 'long' },
    ],
    hasFoodAllergies: 'bool',
    allergies: 'long',
    eatsIndependently: 'bool',
    hasToiletingDifficulties: 'bool',
    toiletingDetails: 'long',
    usesDiapers: 'bool',
    physicianName: 'text',
    physicianHealthFund: 'text',
    physicianPhone: 'phone',
    physicianSummaryDocumentId: 'uuid',
  },
  development: { level: 'text', details: 'long' },
  declarationVersion: 'text',
  declarationAcceptances: ['bool'],
  signatures: { parent1: signature, parent2: signature },
};
function fail(path: string): never {
  throw new BadRequestException({
    code: 'REGISTRATION_VALIDATION',
    message: 'Invalid or incomplete registration field',
    field: path,
  });
}
function shape(value: unknown, rule: Rule, path: string): void {
  if (Array.isArray(rule)) {
    if (!Array.isArray(value) || value.length > 30) fail(path);
    value.forEach((item, i) => shape(item, rule[0], `${path}.${i}`));
    return;
  }
  if (typeof rule === 'object') {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.prototype.toString.call(value) !== '[object Object]' ||
      Object.getPrototypeOf(value)?.constructor?.name !== 'Object'
    )
      fail(path);
    for (const [key, child] of Object.entries(value)) {
      if (!Object.hasOwn(rule, key)) fail(`${path}.${key}`);
      shape(child, rule[key], `${path}.${key}`);
    }
    return;
  }
  if (rule === 'bool') {
    if (typeof value !== 'boolean') fail(path);
    return;
  }
  if (rule === 'count') {
    if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 50)
      fail(path);
    return;
  }
  if (
    typeof value !== 'string' ||
    value.length > (rule === 'long' ? 2000 : 300) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)
  )
    fail(path);
  // Empty strings are valid during partial autosave; final validation is separate.
  if (!value) return;
  if (rule === 'name' && value.length > 100) fail(path);
  if (rule === 'address' && value.length > 255) fail(path);
  if (rule === 'size' && value.length > 50) fail(path);
  if (rule === 'uuid' && !isUUID(value, '4')) fail(path);
  if (rule === 'hash' && !/^[a-f0-9]{64}$/.test(value)) fail(path);
  if (rule === 'id' && !/^\d{5,9}$/.test(value)) fail(path);
  if (rule === 'email' && !isEmail(value)) fail(path);
  if (rule === 'phone' && !/^[+\d() -]{5,30}$/.test(value)) fail(path);
  if (
    rule === 'date' &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !isISO8601(value, { strict: true }) ||
      value > new Date().toISOString().slice(0, 10))
  )
    fail(path);
  if (rule === 'date' && Date.now() - Date.parse(value) > 121 * 366 * 86400000)
    fail(path);
  if (
    rule === 'instant' &&
    (!isISO8601(value, { strict: true }) ||
      !/(Z|[+-]\d{2}:\d{2})$/.test(value) ||
      Date.parse(value) > Date.now() + 300000)
  )
    fail(path);
  if (rule === 'gender' && !['male', 'female'].includes(value)) fail(path);
  if (
    rule === 'shirt' &&
    !['XS', 'S', 'M', 'L', 'XL', 'XXL', 'OTHER'].includes(value)
  )
    fail(path);
}
export function validateDraft(data: unknown): asserts data is RegistrationData {
  if (Buffer.byteLength(JSON.stringify(data) ?? '') > 65536) fail('data.size');
  shape(data, schema, 'data');
}
const required = (value: unknown, path: string) => {
  if (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && !value.trim())
  )
    fail(path);
};
export function validateSubmission(data: RegistrationData) {
  validateDraft(data);
  for (const [path, value] of Object.entries({
    'trainee.name': data.trainee?.name,
    'trainee.familyName': data.trainee?.familyName,
    'trainee.nationalId': data.trainee?.nationalId,
    'trainee.phone': data.trainee?.phone,
    'trainee.dateOfBirth': data.trainee?.dateOfBirth,
    'trainee.address': data.trainee?.address,
    'trainee.gender': data.trainee?.gender,
    'trainee.healthFund': data.trainee?.healthFund,
    'trainee.school': data.trainee?.school,
    'trainee.shirtSize': data.trainee?.shirtSize,
    'trainee.pantsSize': data.trainee?.pantsSize,
    'parent1.name': data.parent1?.name,
    'parent1.phone': data.parent1?.phone,
    'contacts.familyStatus': data.contacts?.familyStatus,
    'contacts.emergencyName': data.contacts?.emergencyName,
    'contacts.emergencyRelationship': data.contacts?.emergencyRelationship,
    'contacts.emergencyPhone': data.contacts?.emergencyPhone,
    'medical.physicianName': data.medical?.physicianName,
    'medical.physicianPhone': data.medical?.physicianPhone,
    'medical.physicianHealthFund': data.medical?.physicianHealthFund,
    'medical.physicianSummaryDocumentId':
      data.medical?.physicianSummaryDocumentId,
    'development.level': data.development?.level,
  }))
    required(value, path);
  for (const path of [
    'hasConditions',
    'participationRestricted',
    'takesMedication',
    'hasFoodAllergies',
    'eatsIndependently',
    'hasToiletingDifficulties',
    'usesDiapers',
  ])
    required(data.medical?.[path], `medical.${path}`);
  if (data.medical?.hasConditions && !data.medical.conditions?.length)
    fail('medical.conditions');
  if (data.medical?.conditions?.some((x) => !x.trim()))
    fail('medical.conditions');
  if (data.medical?.participationRestricted)
    required(data.medical.restrictionDetails, 'medical.restrictionDetails');
  if (data.medical?.takesMedication && !data.medical.medications?.length)
    fail('medical.medications');
  if (!data.medical?.takesMedication && data.medical?.medications?.length)
    fail('medical.takesMedication');
  if (!data.medical?.hasConditions && data.medical?.conditions?.length)
    fail('medical.hasConditions');
  if (!data.medical?.hasFoodAllergies && data.medical?.allergies?.trim())
    fail('medical.hasFoodAllergies');
  data.medical?.medications?.forEach((m) =>
    required(m.name, 'medical.medications.name'),
  );
  if (data.medical?.hasFoodAllergies)
    required(data.medical.allergies, 'medical.allergies');
  if (data.medical?.hasToiletingDifficulties)
    required(data.medical.toiletingDetails, 'medical.toiletingDetails');
  if (data.trainee?.shirtSize === 'OTHER')
    required(data.trainee.customShirtSize, 'trainee.customShirtSize');
  if (!isValidIsraeliNationalId(data.trainee?.nationalId ?? ''))
    fail('trainee.nationalId');
  if (
    data.declarationVersion !== DECLARATION_VERSION ||
    data.declarationAcceptances?.length !== 10 ||
    data.declarationAcceptances.some((x) => x !== true)
  )
    fail('declarationAcceptances');
  for (const parent of ['parent1', 'parent2'] as const) {
    const signing = data.signatures?.[parent];
    if (parent === 'parent1' || signing) {
      required(data[parent]?.name, `${parent}.name`);
      if (!isValidIsraeliNationalId(data[parent]?.nationalId ?? ''))
        fail(`${parent}.nationalId`);
      if (
        !signing?.documentId ||
        !signing.signedAt ||
        signing.contentHash !== contentHash(data)
      )
        fail(`signatures.${parent}`);
    } else if (
      data.parent2?.nationalId &&
      !isValidIsraeliNationalId(data.parent2.nationalId)
    )
      fail('parent2.nationalId');
  }
  if (
    data.signatures?.parent2 &&
    normalizeIsraeliNationalId(data.parent1!.nationalId!) ===
      normalizeIsraeliNationalId(data.parent2!.nationalId!)
  ) {
    fail('parent2.nationalId');
  }
}
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export const contentHash = (data: RegistrationData) => {
  const { signatures: _ignored, ...content } = data;
  return createHash('sha256').update(canonical(content)).digest('hex');
};
// Encrypt national IDs inside JSONB using the existing versioned AES-GCM mechanism.
// Never apply User.toJSON to evidence: it would silently remove signed fields.
export function protectData(
  data: RegistrationData,
  decrypt = false,
): RegistrationData {
  const copy = structuredClone(data);
  for (const field of ['trainee', 'parent1', 'parent2'] as const) {
    const value = copy[field]?.nationalId;
    if (value)
      copy[field]!.nationalId = decrypt
        ? decryptNationalId(value)
        : encryptNationalId(value);
  }
  return copy;
}
export const readData = (data: RegistrationData) => protectData(data, true);
