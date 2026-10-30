import {
  VOLUNTEER_AGREEMENT_VERSION,
  VOLUNTEER_DECLARATIONS,
  VOLUNTEER_SOURCE_SHA256,
} from './volunteer.legal';
import {
  jerusalemDate,
  needsParent,
  type VolunteerData,
  type VolunteerPurpose,
} from './volunteer.contract';
import { validateVolunteerSubmission } from './volunteer.validation';
export const VOLUNTEER_TEMPLATE_VERSION = 'volunteer-registration/v1';
export function volunteerRenderRequest(
  data: VolunteerData,
  meta: {
    reference: string;
    applicationId: string;
    branch: string;
    submittedAt: string;
  },
  images: Partial<Record<VolunteerPurpose, string>>,
  declarations: readonly string[] = VOLUNTEER_DECLARATIONS,
) {
  validateVolunteerSubmission(data, jerusalemDate(new Date(meta.submittedAt)));
  const minor = needsParent(data, jerusalemDate(new Date(meta.submittedAt))),
    v = data.volunteer!;
  const signatures: Partial<Record<VolunteerPurpose, unknown>> = {};
  for (const purpose of [
    'VOLUNTEER_AGREEMENT',
    ...(minor ? ['PARENTAL_CONSENT'] : []),
    'CONFIDENTIALITY',
  ] as VolunteerPurpose[]) {
    const s = data.signatures![purpose]!,
      parent = purpose === 'PARENTAL_CONSENT';
    if (!images[purpose])
      throw new Error('Verified signature image is missing');
    signatures[purpose] = {
      name: parent
        ? data.parentConsent!.name
        : `${v.firstName} ${v.lastName}`.trim(),
      nationalId: parent ? data.parentConsent!.nationalId : v.nationalId,
      signedAt: s.signedAt,
      image: images[purpose],
      agreementVersion: s.agreementVersion,
      contentHash: s.contentHash,
    };
  }
  // Clearance bytes/references and applicant credentials are never render inputs.
  return {
    template: 'volunteer-registration' as const,
    version: 'v1' as const,
    declarationVersion: VOLUNTEER_AGREEMENT_VERSION,
    sourceChecksum: VOLUNTEER_SOURCE_SHA256,
    registration: meta,
    volunteer: structuredClone(v),
    questionnaire: structuredClone(data.questionnaire!),
    agreements: structuredClone(data.agreements!),
    ...(minor ? { parentConsent: structuredClone(data.parentConsent) } : {}),
    signatures,
    declarations: [...declarations],
  };
}
