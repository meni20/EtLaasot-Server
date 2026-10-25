import { admissionPolicy, registrationType } from './admission.policy';
import { DECLARATIONS } from '../parent-registration/declarations';
import { fictionalRegistration } from '../parent-registration/registration.test-fixtures';

describe('Shared admission policies (offline)', () => {
  const original = { ...process.env };
  afterEach(() => {
    process.env = { ...original };
  });
  it('defaults only absent legacy types, never invalid types', () => {
    expect(registrationType()).toBe('TRAINEE');
    for (const value of [null, '', 'ADMIN', 1])
      expect(() => registrationType(value)).toThrow();
  });
  it('retains trainee declarations, partial drafts and submission validation', () => {
    const policy = admissionPolicy();
    expect(policy.declarations).toEqual(DECLARATIONS);
    expect(() => policy.validateDraft({})).not.toThrow();
    expect(() => policy.validateSubmission({})).toThrow();
    expect(() => policy.validateDraft(fictionalRegistration())).not.toThrow();
    expect(policy.evidenceKinds).not.toContain('POLICE_CLEARANCE');
  });
  it.each([undefined, 'false', 'true'])(
    'gates volunteer operations independently (flag=%s)',
    (flag) => {
      if (flag === undefined) delete process.env.VOLUNTEER_REGISTRATION_ENABLED;
      else process.env.VOLUNTEER_REGISTRATION_ENABLED = flag;
      const policy = admissionPolicy('VOLUNTEER');
      expect(policy.signaturePurposes).toContain('PARENTAL_CONSENT');
      expect(policy.evidenceKinds).toContain('POLICE_CLEARANCE');
      for (const operation of [
        'START',
        'READ',
        'SAVE',
        'SUBMIT',
        'UPLOAD',
        'PDF',
        'CORRECT',
        'REVIEW',
        'APPROVE',
      ] as const)
        if (
          flag === 'true' &&
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
          expect(() => policy.assertAvailable(operation)).not.toThrow();
        else expect(() => policy.assertAvailable(operation)).toThrow();
      expect(() => policy.validateDraft({})).not.toThrow();
      expect(() => policy.validateSubmission({})).toThrow();
    },
  );
});
