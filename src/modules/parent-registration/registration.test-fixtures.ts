// Fictional data shared by offline tests and the opt-in isolated DB suite only.
import { randomUUID } from 'crypto';
import { DECLARATION_VERSION } from './declarations';
import { contentHash } from './registration.validation';
import type { RegistrationData } from './registration.validation';

export function fictionalRegistration(twoParents = true): RegistrationData {
  const data: RegistrationData = {
    trainee: {
      name: 'חניך',
      familyName: 'בדיקה',
      nationalId: '123456782',
      phone: '0500000000',
      email: 'fictional@example.invalid',
      dateOfBirth: '2010-01-01',
      address: 'כתובת בדיקה בלבד',
      gender: 'male',
      healthFund: 'בדיקה',
      school: 'בית ספר לדוגמה',
      shirtSize: 'M',
      pantsSize: 'M',
    },
    parent1: {
      name: 'הורה ראשון לדוגמה',
      nationalId: '123456782',
      phone: '0500000001',
    },
    ...(twoParents
      ? {
          parent2: {
            name: 'הורה שני לדוגמה',
            nationalId: '000000018',
            phone: '0500000002',
          },
        }
      : {}),
    contacts: {
      familyStatus: 'בדיקה',
      emergencyName: 'איש קשר לדוגמה',
      emergencyRelationship: 'משפחה',
      emergencyPhone: '0500000003',
    },
    medical: {
      hasConditions: false,
      participationRestricted: false,
      takesMedication: false,
      hasFoodAllergies: false,
      eatsIndependently: true,
      hasToiletingDifficulties: false,
      usesDiapers: false,
      physicianName: 'רופא לדוגמה',
      physicianHealthFund: 'בדיקה',
      physicianPhone: '0500000004',
      physicianSummaryDocumentId: randomUUID(),
    },
    development: { level: 'בדיקה בלבד' },
    declarationVersion: DECLARATION_VERSION,
    declarationAcceptances: Array(10).fill(true),
  };
  data.signatures = {
    parent1: {
      documentId: randomUUID(),
      contentHash: contentHash(data),
      signedAt: new Date().toISOString(),
    },
  };
  if (twoParents)
    data.signatures.parent2 = {
      documentId: randomUUID(),
      contentHash: contentHash(data),
      signedAt: new Date().toISOString(),
    };
  return data;
}
