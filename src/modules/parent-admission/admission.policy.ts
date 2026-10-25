import {
  validateVolunteerDraft,
  validateVolunteerSubmission,
} from './volunteer.validation';
import {
  VOLUNTEER_DECLARATIONS,
  VOLUNTEER_AGREEMENT_VERSION,
} from './volunteer.legal';
import type { VolunteerData } from './volunteer.contract';
import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { getBooleanEnv } from '../../config/env.util';
import {
  DECLARATIONS,
  DECLARATION_VERSION,
  TEMPLATE_VERSION,
} from '../parent-registration/declarations';
import {
  validateDraft,
  validateSubmission,
  type RegistrationData,
} from '../parent-registration/registration.validation';

export const REGISTRATION_TYPES = ['TRAINEE', 'VOLUNTEER'] as const;
export type RegistrationType = (typeof REGISTRATION_TYPES)[number];

export type VolunteerRegistrationData = VolunteerData;
export interface ApplicationDataByType {
  TRAINEE: RegistrationData;
  VOLUNTEER: VolunteerRegistrationData;
}
export type ApplicationFormData<T extends RegistrationType = 'TRAINEE'> =
  ApplicationDataByType[T];
export type AdmissionOperation =
  | 'START'
  | 'READ'
  | 'SAVE'
  | 'SUBMIT'
  | 'UPLOAD'
  | 'PDF'
  | 'CORRECT'
  | 'REVIEW'
  | 'APPROVE';
export type SignaturePurpose =
  | 'VOLUNTEER_AGREEMENT'
  | 'PARENTAL_CONSENT'
  | 'CONFIDENTIALITY';
export type ApplicationEvidenceKind =
  | 'PHYSICIAN_SUMMARY'
  | 'SIGNATURE'
  | 'REGISTRATION_PDF'
  | 'POLICE_CLEARANCE';

export function registrationType(value: unknown = 'TRAINEE'): RegistrationType {
  if (value !== 'TRAINEE' && value !== 'VOLUNTEER')
    throw new BadRequestException('Invalid registration type');
  return value;
}

export interface AdmissionPolicy<
  T extends RegistrationType = RegistrationType,
> {
  readonly type: T;
  readonly declarations: readonly string[];
  readonly declarationVersion: string;
  readonly templateVersion: string;
  readonly evidenceKinds: readonly ApplicationEvidenceKind[];
  readonly signaturePurposes: readonly SignaturePurpose[];
  assertAvailable(operation: AdmissionOperation): void;
  validateDraft(data: ApplicationFormData<T>): void;
  validateSubmission(data: ApplicationFormData<T>): void;
}

const volunteerAvailability = (operation: AdmissionOperation): void => {
  if (!getBooleanEnv('VOLUNTEER_REGISTRATION_ENABLED', false))
    throw new NotFoundException();
  if (
    [
      'START',
      'READ',
      'SAVE',
      'SUBMIT',
      'UPLOAD',
      'PDF',
      'CORRECT',
      'REVIEW',
      'APPROVE',
    ].includes(operation)
  )
    return;
  // Unknown operations fail closed even when the independent volunteer flag is enabled.
  throw new ServiceUnavailableException({
    code: 'VOLUNTEER_REGISTRATION_NOT_READY',
    message: 'Volunteer registration is not available yet',
  });
};

const traineePolicy: AdmissionPolicy<'TRAINEE'> = {
  type: 'TRAINEE',
  declarations: DECLARATIONS,
  declarationVersion: DECLARATION_VERSION,
  templateVersion: TEMPLATE_VERSION,
  evidenceKinds: ['PHYSICIAN_SUMMARY', 'SIGNATURE', 'REGISTRATION_PDF'],
  signaturePurposes: [],
  assertAvailable: () => {},
  validateDraft,
  validateSubmission,
};
const volunteerPolicy: AdmissionPolicy<'VOLUNTEER'> = {
  type: 'VOLUNTEER',
  declarations: VOLUNTEER_DECLARATIONS,
  declarationVersion: VOLUNTEER_AGREEMENT_VERSION,
  templateVersion: 'volunteer-registration/v1',
  evidenceKinds: ['SIGNATURE', 'REGISTRATION_PDF', 'POLICE_CLEARANCE'],
  signaturePurposes: [
    'VOLUNTEER_AGREEMENT',
    'PARENTAL_CONSENT',
    'CONFIDENTIALITY',
  ],
  assertAvailable: volunteerAvailability,
  validateDraft: validateVolunteerDraft,
  validateSubmission: validateVolunteerSubmission,
};

export function admissionPolicy(type: unknown = 'TRAINEE'): AdmissionPolicy {
  return registrationType(type) === 'TRAINEE' ? traineePolicy : volunteerPolicy;
}
