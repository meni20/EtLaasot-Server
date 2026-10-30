import type { RegistrationData, Person } from './registration.validation';

// Matches Documents RenderRequestDto v1. Keep this adapter explicit: do not send
// encrypted JSONB, applicant credentials, medical assets or arbitrary HTML.
export interface RegistrationRenderRequest {
  template: 'parent-registration';
  version: 'v1';
  declarationVersion: 'v1';
  registration: {
    reference: string;
    branch: string;
    year: string;
    date: string;
  };
  trainee: {
    firstName: string;
    lastName: string;
    nickname?: string;
    nationalId: string;
    birthDate: string;
    healthFund: string;
    address: string;
    phone: string;
    siblings: number | null;
    gender: 'זכר' | 'נקבה';
    shirtSize?: string;
    pantsSize?: string;
    email?: string;
  };
  parents: { parent1?: RenderPerson; parent2?: RenderPerson; status?: string };
  emergencyContact: { name: string; relationship: string; phone: string };
  education: {
    school?: string;
    phone?: string;
    counselor?: string;
    counselorPhone?: string;
  };
  medical: {
    hasConditions: boolean;
    diagnoses: string[];
    participationLimitations: string;
    participationRestricted: boolean;
    hasFoodAllergies: boolean;
    takesMedication: boolean;
    medications: { name: string; dosage: string; instructions?: string }[];
    allergies: string;
    eatsIndependently: boolean;
    eatingDetails: string;
    mobilityDifficulty: boolean | null;
    toiletingDifficulty: boolean;
    toiletingDetails: string;
    usesDiaper: boolean;
    mobilityDetails: string;
    summaryAttached: boolean;
  };
  developmental: {
    ageAppropriate: boolean | null;
    intellectualDisability: 'ללא' | 'קל' | 'בינוני' | 'עמוק' | null;
    autismPdd: boolean | null;
    attention: 'ללא' | 'קל' | 'בינוני' | 'עמוק' | null;
    other: string;
  };
  physician: { name: string; healthFund: string; phone: string };
  signatures: { parent1: RenderSignature; parent2?: RenderSignature };
}
type RenderPerson = {
  name: string;
  nationalId?: string;
  phone?: string;
  occupation?: string;
  birthDate?: string;
  email?: string;
};
type RenderSignature = {
  name: string;
  nationalId: string;
  signedAt: string;
  image: string;
};
export function registrationRenderRequest(
  data: RegistrationData,
  context: RegistrationRenderRequest['registration'],
  images: { parent1: string; parent2?: string },
): RegistrationRenderRequest {
  const t = data.trainee!,
    m = data.medical!,
    c = data.contacts!;
  const parent = (p: Person): RenderPerson => ({
    name: p.name || 'לא צוין',
    nationalId: p.nationalId,
    phone: p.phone!,
    ...(p.occupation ? { occupation: p.occupation } : {}),
    ...(p.dateOfBirth ? { birthDate: p.dateOfBirth } : {}),
    ...(p.email ? { email: p.email } : {}),
  });
  const signature = (key: 'parent1' | 'parent2'): RenderSignature => ({
    name: data[key]!.name!,
    nationalId: data[key]!.nationalId!,
    signedAt: data.signatures![key]!.signedAt,
    image: images[key]!,
  });
  const level = data.development?.level ?? '';
  return {
    template: 'parent-registration',
    version: 'v1',
    declarationVersion: 'v1',
    registration: context,
    trainee: {
      firstName: t.name!,
      lastName: t.familyName!,
      nationalId: t.nationalId!,
      birthDate: t.dateOfBirth!,
      healthFund: t.healthFund!,
      address: t.address!,
      phone: t.phone!,
      siblings: t.siblings ?? null,
      gender: t.gender === 'male' ? 'זכר' : 'נקבה',
      ...(t.nickname ? { nickname: t.nickname } : {}),
      shirtSize: t.customShirtSize || t.shirtSize,
      pantsSize: t.pantsSize,
      ...(t.email ? { email: t.email } : {}),
    },
    parents: {
      parent1: parent(data.parent1!),
      ...(data.parent2 && Object.values(data.parent2).some(Boolean)
        ? { parent2: parent(data.parent2) }
        : {}),
      status: c.familyStatus,
    },
    emergencyContact: {
      name: c.emergencyName!,
      relationship: c.emergencyRelationship!,
      phone: c.emergencyPhone!,
    },
    education: {
      school: t.school,
      ...(c.schoolPhone ? { phone: c.schoolPhone } : {}),
      ...(c.schoolCounselor ? { counselor: c.schoolCounselor } : {}),
      ...(c.schoolCounselorPhone
        ? { counselorPhone: c.schoolCounselorPhone }
        : {}),
    },
    medical: {
      hasConditions: m.hasConditions!,
      diagnoses: m.conditions ?? [],
      participationLimitations: m.restrictionDetails ?? '',
      participationRestricted: m.participationRestricted!,
      hasFoodAllergies: m.hasFoodAllergies!,
      takesMedication: m.takesMedication!,
      medications: (m.medications ?? []).map((x) => ({
        name: x.name,
        dosage: x.dosage || 'לא צוין',
        instructions: [x.frequency, x.instructions].filter(Boolean).join('; '),
      })),
      allergies: m.allergies ?? '',
      eatsIndependently: m.eatsIndependently!,
      eatingDetails: '',
      mobilityDifficulty: null,
      toiletingDifficulty: m.hasToiletingDifficulties!,
      toiletingDetails: m.toiletingDetails ?? '',
      usesDiaper: m.usesDiapers!,
      mobilityDetails: '',
      summaryAttached: !!m.physicianSummaryDocumentId,
    },
    developmental: {
      ageAppropriate:
        level === 'מתאים לגיל הכרונולוגי'
          ? true
          : level === 'לא מתאים לגיל הכרונולוגי'
            ? false
            : null,
      intellectualDisability:
        level === 'מש״ה קל' ? 'קל' : level === 'מש״ה בינוני' ? 'בינוני' : null,
      autismPdd: level === 'אוטיזם / PDD' ? true : null,
      attention: null,
      other: [level, data.development?.details].filter(Boolean).join(': '),
    },
    physician: {
      name: m.physicianName!,
      healthFund: m.physicianHealthFund!,
      phone: m.physicianPhone!,
    },
    signatures: {
      parent1: signature('parent1'),
      ...(data.signatures?.parent2 ? { parent2: signature('parent2') } : {}),
    },
  };
}
