import { randomBytes, randomUUID } from 'crypto';
import { fictionalRegistration } from './registration.test-fixtures';
import {
  contentHash,
  protectData,
  readData,
  validateSubmission,
  retainParentApplicability,
} from './registration.validation';
import { registrationRenderRequest } from './registration-render.contract';
import { volunteerIssues } from '../parent-admission/volunteer.contract';
import { validateVolunteerDraft } from '../parent-admission/volunteer.validation';
const rebind = (data: ReturnType<typeof fictionalRegistration>) => {
  for (const s of Object.values(data.signatures ?? {}))
    s.contentHash = contentHash(data);
  return data;
};
afterEach(() => {
  delete process.env.NATIONAL_ID_ENCRYPTION_KEY;
});
it.each(['parent1', 'parent2'] as const)(
  'supports independent %s exemption, active signature and render mapping',
  (key) => {
    const data = fictionalRegistration(true);
    data.parent1!.notApplicable = false;
    data.parent2!.notApplicable = false;
    data[key]!.notApplicable = true;
    delete data.signatures![key];
    rebind(data);
    expect(() => validateSubmission(data)).not.toThrow();
    const payload = registrationRenderRequest(
      data,
      { reference: 'test', branch: 'test', year: 'test', date: '2026-11-10' },
      { parent1: 'image', parent2: 'image' },
    );
    expect(payload.parents[key]).toBeUndefined();
    expect(payload.signatures[key]).toBeUndefined();
    process.env.NATIONAL_ID_ENCRYPTION_KEY = randomBytes(32).toString('hex');
    expect(readData(protectData(data))).toEqual(data);
  },
);
it('requires both default parents, rejects both exemptions and stale exempt signatures', () => {
  const data = fictionalRegistration(true);
  data.parent1!.notApplicable = false;
  data.parent2!.notApplicable = false;
  delete data.parent2!.phone;
  rebind(data);
  expect(() => validateSubmission(data)).toThrow();
  data.parent1!.notApplicable = true;
  data.parent2!.notApplicable = true;
  delete data.signatures;
  expect(() => validateSubmission(data)).toThrow();
  const stale = fictionalRegistration(true);
  stale.parent2!.notApplicable = true;
  rebind(stale);
  expect(() => validateSubmission(stale)).toThrow();
});
it('retains stored applicability when a full draft omits flags and accepts immutable legacy single-parent content', () => {
  const old = fictionalRegistration(false);
  expect(() => validateSubmission(old)).not.toThrow();
  const next = structuredClone(old);
  old.parent1!.notApplicable = false;
  old.parent2 = { notApplicable: true, name: 'retained name' };
  retainParentApplicability(old, next);
  expect(next.parent1!.notApplicable).toBe(false);
  expect(next.parent2!.notApplicable).toBe(true);
});
it('volunteer phone exemptions are independent, typed and preserve entered phone text', () => {
  const data = {
    volunteer: {
      motherPhone: '123',
      fatherPhone: '123',
      motherPhoneNotApplicable: true,
      fatherPhoneNotApplicable: true,
    },
  };
  expect(() => validateVolunteerDraft(data)).not.toThrow();
  expect(
    volunteerIssues(data, 'volunteer-v1').filter((x) =>
      x.path.endsWith('Phone'),
    ),
  ).toEqual([]);
  data.volunteer.fatherPhoneNotApplicable = false;
  expect(
    volunteerIssues(data, 'volunteer-v1').some(
      (x) => x.path === 'volunteer.fatherPhone',
    ),
  ).toBe(true);
  expect(() =>
    validateVolunteerDraft({
      ...data,
      volunteer: { ...data.volunteer, motherPhoneNotApplicable: 'yes' },
    }),
  ).toThrow();
});
