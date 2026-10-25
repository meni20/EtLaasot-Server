// Mirrored in Client's volunteer-registration/contracts.ts; parity tested.
export type VolunteerPurpose =
  | 'VOLUNTEER_AGREEMENT'
  | 'PARENTAL_CONSENT'
  | 'CONFIDENTIALITY';
export const VOLUNTEER_PURPOSES: VolunteerPurpose[] = [
  'VOLUNTEER_AGREEMENT',
  'PARENTAL_CONSENT',
  'CONFIDENTIALITY',
];
export interface VolunteerSignature {
  documentId: string;
  contentHash: string;
  signedAt: string;
  agreementVersion: string;
}
export interface VolunteerData {
  volunteer?: {
    firstName?: string;
    lastName?: string;
    nationalId?: string;
    dateOfBirth?: string;
    gender?: 'male' | 'female';
    address?: string;
    school?: string;
    grade?: string;
    email?: string;
    phone?: string;
    shirtSize?: string;
    customShirtSize?: string;
    motherName?: string;
    motherPhone?: string;
    fatherName?: string;
    fatherPhone?: string;
  };
  questionnaire?: {
    preference?: 'משחקייה' | 'חונכות בית' | 'אחר';
    other?: string;
    age?: 'קטן' | 'בוגר';
    communication?: 'מדבר' | 'לא מתקשר';
    diaper?: 'עם טיטול' | 'ללא טיטול';
    instructionExperience?: boolean;
    instructionDetails?: string;
    specialNeedsExperience?: boolean;
    specialNeedsDetails?: string;
    motivation?: string;
  };
  agreements?: {
    version?: string;
    volunteer?: boolean;
    confidentiality?: boolean;
  };
  parentConsent?: {
    name?: string;
    nationalId?: string;
    date?: string;
    acknowledged?: boolean;
  };
  policeClearanceDocumentId?: string;
  signatures?: Partial<Record<VolunteerPurpose, VolunteerSignature>>;
}
export function jerusalemDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function eighteenthBirthday(birth?: string): string {
  if (!birth || !/^\d{4}-\d{2}-\d{2}$/.test(birth)) return '';
  const year = Number(birth.slice(0, 4)) + 18;
  // Feb 29 anniversaries in non-leap years use March 1; record the policy.
  const date = new Date(`${year}${birth.slice(4)}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
}
export const needsParent = (data: VolunteerData, today = jerusalemDate()) =>
  !!data.volunteer?.dateOfBirth &&
  today < eighteenthBirthday(data.volunteer.dateOfBirth);
// Literal source: male applicants older than 18, not an expanded requirement.
export const needsClearance = (data: VolunteerData, today = jerusalemDate()) =>
  data.volunteer?.gender === 'male' &&
  !!eighteenthBirthday(data.volunteer.dateOfBirth) &&
  today > eighteenthBirthday(data.volunteer.dateOfBirth);
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function coveredData(
  data: VolunteerData,
  purpose: VolunteerPurpose,
  version: string,
): unknown {
  const v = data.volunteer ?? {};
  const identity = {
    firstName: v.firstName,
    lastName: v.lastName,
    nationalId: v.nationalId,
    dateOfBirth: v.dateOfBirth,
  };
  if (purpose === 'VOLUNTEER_AGREEMENT')
    return {
      purpose,
      version,
      volunteer: v,
      questionnaire: data.questionnaire,
      acknowledged: data.agreements?.volunteer,
    };
  if (purpose === 'PARENTAL_CONSENT')
    return { purpose, version, identity, parent: data.parentConsent };
  const { signatures, ...content } = data;
  return {
    purpose,
    version,
    content,
    priorSignatures: {
      VOLUNTEER_AGREEMENT: signatures?.VOLUNTEER_AGREEMENT,
      PARENTAL_CONSENT: signatures?.PARENTAL_CONSENT,
    },
  };
}
export function reconcileSignatures(
  previous: VolunteerData,
  next: VolunteerData,
  version: string,
): VolunteerData {
  const copy = structuredClone(next);
  for (const purpose of VOLUNTEER_PURPOSES) {
    if (
      canonical(coveredData(previous, purpose, version)) !==
      canonical(coveredData(copy, purpose, version))
    )
      delete copy.signatures?.[purpose];
  }
  return copy;
}
export interface VolunteerIssue {
  path: string;
  stage: number;
  message: string;
}
export function volunteerIssues(
  data: VolunteerData,
  version: string,
  today = jerusalemDate(),
): VolunteerIssue[] {
  const issues: VolunteerIssue[] = [];
  const add = (path: string, stage: number, message = 'יש להשלים שדה זה') =>
    issues.push({ path, stage, message });
  const v = data.volunteer ?? {},
    q = data.questionnaire ?? {};
  for (const key of [
    'firstName',
    'lastName',
    'nationalId',
    'dateOfBirth',
    'gender',
    'address',
    'email',
    'phone',
    'shirtSize',
    'motherName',
    'motherPhone',
    'fatherName',
    'fatherPhone',
  ] as const)
    if (!v[key]?.trim()) add(`volunteer.${key}`, 1);
  if (needsParent(data, today))
    for (const key of ['school', 'grade'] as const)
      if (!v[key]?.trim()) add(`volunteer.${key}`, 1);
  const validId = (id: string) =>
    /^\d{5,9}$/.test(id) &&
    id
      .padStart(9, '0')
      .split('')
      .reduce((sum, n, i) => {
        const x = Number(n) * ((i % 2) + 1);
        return sum + (x > 9 ? x - 9 : x);
      }, 0) %
      10 ===
      0;
  if (v.nationalId && !validId(v.nationalId))
    add('volunteer.nationalId', 1, 'תעודת הזהות אינה תקינה');
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email))
    add('volunteer.email', 1, 'כתובת המייל אינה תקינה');
  if (
    v.dateOfBirth &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(v.dateOfBirth) ||
      !Number.isFinite(Date.parse(v.dateOfBirth)) ||
      new Date(v.dateOfBirth).toISOString().slice(0, 10) !== v.dateOfBirth ||
      v.dateOfBirth > today)
  )
    add('volunteer.dateOfBirth', 1, 'תאריך הלידה אינו תקין');
  for (const key of ['phone', 'motherPhone', 'fatherPhone'] as const)
    if (v[key] && !/^[+\d() -]{5,30}$/.test(v[key]!))
      add(`volunteer.${key}`, 1, 'מספר הטלפון אינו תקין');
  for (const key of [
    'preference',
    'age',
    'communication',
    'diaper',
    'motivation',
  ] as const)
    if (!q[key]?.trim()) add(`questionnaire.${key}`, 2);
  for (const [flag, details] of [
    ['instructionExperience', 'instructionDetails'],
    ['specialNeedsExperience', 'specialNeedsDetails'],
  ] as const) {
    if (typeof q[flag] !== 'boolean')
      add(`questionnaire.${flag}`, 2, 'יש לבחור כן או לא');
    if (q[flag] && !q[details]?.trim()) add(`questionnaire.${details}`, 2);
  }
  if (v.shirtSize === 'OTHER' && !v.customShirtSize?.trim())
    add('volunteer.customShirtSize', 1);
  if (q.preference === 'אחר' && !q.other?.trim()) add('questionnaire.other', 2);
  if (
    data.agreements?.version !== version ||
    data.agreements.volunteer !== true
  )
    add('agreements.volunteer', 3, 'יש לאשר את ההסכם');
  if (data.agreements?.confidentiality !== true)
    add('agreements.confidentiality', 5, 'יש לאשר את ההתחייבות');
  const purposes: VolunteerPurpose[] = [
    'VOLUNTEER_AGREEMENT',
    'CONFIDENTIALITY',
  ];
  if (needsParent(data, today)) {
    purposes.push('PARENTAL_CONSENT');
    for (const key of ['name', 'nationalId', 'date'] as const)
      if (!data.parentConsent?.[key]?.trim()) add(`parentConsent.${key}`, 4);
    if (
      data.parentConsent?.nationalId &&
      !validId(data.parentConsent.nationalId)
    )
      add('parentConsent.nationalId', 4, 'תעודת הזהות אינה תקינה');
    if (data.parentConsent?.date && data.parentConsent.date > today)
      add('parentConsent.date', 4, 'התאריך אינו תקין');
    if (data.parentConsent?.acknowledged !== true)
      add('parentConsent.acknowledged', 4, 'נדרש אישור ההורה');
  }
  for (const purpose of purposes)
    if (
      !data.signatures?.[purpose] ||
      data.signatures[purpose]!.agreementVersion !== version
    )
      add(
        `signatures.${purpose}`,
        purpose === 'VOLUNTEER_AGREEMENT'
          ? 3
          : purpose === 'PARENTAL_CONSENT'
            ? 4
            : 5,
        'יש להשלים חתימה',
      );
  if (needsClearance(data, today) && !data.policeClearanceDocumentId)
    add('policeClearanceDocumentId', 5, 'יש לצרף אישור משטרה');
  return issues;
}
