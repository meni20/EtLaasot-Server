// Invoked only inside the fresh loopback-only cluster owned by the local runner.
module.exports = async ({ client, db, root, users }) => {
  const assert = require('node:assert/strict'),
    fs = require('node:fs'),
    path = require('node:path');
  const { randomBytes, randomUUID } = require('node:crypto');
  await client.query(
    fs.readFileSync(
      path.join(root, 'migrations/034_volunteer_clearance_images.sql'),
      'utf8',
    ),
  );
  await client.query(
    fs.readFileSync(
      path.join(root, 'migrations/035_volunteer_pdf_metadata.sql'),
      'utf8',
    ),
  );
  await client.query(
    fs.readFileSync(
      path.join(root, 'migrations/036_application_review_reasons.sql'),
      'utf8',
    ),
  );
  process.env.VOLUNTEER_REGISTRATION_ENABLED = 'true';
  process.env.PARENT_REGISTRATION_TOKEN_PEPPER =
    randomBytes(32).toString('hex');
  const {
    AdmissionService,
  } = require('../src/modules/parent-admission/admission.service');
  const {
    AdmissionRepository,
  } = require('../src/modules/parent-admission/admission.repository');
  const {
    AuthorizationService,
  } = require('../src/modules/auth/authorization.service');
  const {
    RegistrationIntegrationService,
  } = require('../src/modules/parent-registration/registration-integration.service');
  const {
    VOLUNTEER_AGREEMENT_VERSION: version,
  } = require('../src/modules/parent-admission/volunteer.legal');
  const {
    reconcileSignatures,
  } = require('../src/modules/parent-admission/volunteer.contract');
  const {
    volunteerScopeHash,
  } = require('../src/modules/parent-admission/volunteer.validation');
  const integration = new RegistrationIntegrationService(db),
    objects = new Map();
  integration.enabled = () => true;
  integration.attest = async () => {};
  if (!process.argv.includes('--phase3'))
    integration.generateVolunteer = async () => {
      throw new Error('Renderer not enabled in the Phase 2 harness');
    };
  integration.bucket = async () => ({
    name: 'trainee-documents',
    store: {
      upload: async (key, bytes) => {
        objects.set(key, Buffer.from(bytes));
        return { error: null };
      },
      download: async (key) => ({
        data: objects.has(key) ? new Blob([objects.get(key)]) : null,
        error: null,
      }),
    },
  });
  const service = new AdmissionService(
    new AdmissionRepository(db),
    new AuthorizationService(),
    users,
    { availability: () => 'READY' },
    integration,
  );
  const before = (await client.query('SELECT count(*) FROM "user"')).rows[0]
    .count;
  const started = await service.start('000000018', 'branch-a', 'VOLUNTEER');
  let revision = 0,
    data = {
      volunteer: {
        firstName: 'בדיקה',
        lastName: 'מקומית',
        nationalId: '000000018',
        dateOfBirth: '2000-01-01',
        gender: 'male',
        address: 'כתובת בדיקה',
        email: 'fictional@example.invalid',
        phone: '0520000000',
        shirtSize: 'M',
        motherName: 'בדיקה',
        motherPhone: '0500000000',
        fatherName: 'בדיקה',
        fatherPhone: '0500000001',
      },
      questionnaire: {
        preference: 'משחקייה',
        age: 'קטן',
        communication: 'מדבר',
        diaper: 'ללא טיטול',
        instructionExperience: false,
        specialNeedsExperience: false,
        motivation: 'בדיקה מקומית בלבד',
      },
      agreements: { version, volunteer: true, confidentiality: true },
    };
  async function save(next = data) {
    const result = await service.save(started.token, {
      revision,
      currentStep: 5,
      data: next,
    });
    revision = result.application.revision;
    data = result.data;
    return result;
  }
  await save();
  const signature = fs.readFileSync(
    path.join(root, '../EtLaasot-Documents/mock/signature.png'),
  );
  async function sign(purpose) {
    const result = await service.upload(
      started.token,
      revision,
      'SIGNATURE',
      signature,
      purpose,
    );
    const { documentId, contentHash, signedAt, agreementVersion } = result;
    await save({
      ...data,
      signatures: {
        ...data.signatures,
        [purpose]: { documentId, contentHash, signedAt, agreementVersion },
      },
    });
  }
  await sign('VOLUNTEER_AGREEMENT');
  await assert.rejects(
    service.submit(started.token, { revision, idempotencyKey: randomUUID() }),
  );
  const clearance = await service.upload(
    started.token,
    revision,
    'POLICE_CLEARANCE',
    signature,
  );
  await save({ ...data, policeClearanceDocumentId: clearance.documentId });
  await sign('CONFIDENTIALITY');
  const restored = await service.me(started.token);
  assert.equal(restored.data.volunteer.firstName, 'בדיקה');
  assert.equal(restored.data.volunteer.phone, '0520000000');
  assert.equal(
    restored.legal.clearance,
    'חובה לצרף אישור משטרה (לגברים מעל גיל 18)',
  );
  const stale = revision - 1;
  await assert.rejects(
    service.save(started.token, { revision: stale, currentStep: 1, data }),
    /Reload/,
  );
  const unrelated = {
    ...data,
    questionnaire: { ...data.questionnaire, motivation: 'תיקון מקומי' },
  };
  assert.equal(
    reconcileSignatures(data, unrelated, version).signatures
      .VOLUNTEER_AGREEMENT,
    undefined,
  );
  const original = structuredClone(data);
  const tampered = {
    ...data,
    signatures: {
      ...data.signatures,
      CONFIDENTIALITY: {
        ...data.signatures.CONFIDENTIALITY,
        documentId: data.signatures.VOLUNTEER_AGREEMENT.documentId,
      },
    },
  };
  // A copied asset cannot stand in for another signature purpose.
  await assert.rejects(
    integration.verifyVolunteerSigned(
      started.application.id,
      tampered,
      await new AdmissionRepository(db).transaction((t) =>
        new AdmissionRepository(db).evidence(started.application.id, t),
      ),
    ),
  );
  assert.equal(
    data.signatures.CONFIDENTIALITY.contentHash,
    volunteerScopeHash(original, 'CONFIDENTIALITY'),
  );
  let documents;
  const originalFetch = global.fetch;
  if (process.argv.includes('--phase3')) {
    process.env.INTERNAL_API_KEY = randomBytes(32).toString('hex');
    process.env.PDF_BROWSER_CHANNEL = 'chrome';
    process.env.NODE_ENV = 'development';
    documents =
      await require('../../EtLaasot-Documents/dist/bootstrap').createApp();
    await documents.listen(0, '127.0.0.1');
    process.env.REGISTRATION_DOCUMENTS_URL = `http://127.0.0.1:${documents.getHttpServer().address().port}`;
    process.env.REGISTRATION_DOCUMENTS_API_KEY = process.env.INTERNAL_API_KEY;
    global.fetch = async (...args) => {
      if (String(args[0]).startsWith(process.env.REGISTRATION_DOCUMENTS_URL)) {
        await db.transaction(async (t) => {
          await db.query("SET LOCAL lock_timeout='1500ms'", {
            transaction: t,
            logging: false,
          });
          await db.query(
            'SELECT id FROM trainee_applications WHERE id=:id FOR UPDATE',
            {
              replacements: { id: started.application.id },
              transaction: t,
              logging: false,
            },
          );
        });
      }
      return originalFetch(...args);
    };
  }
  try {
    const key = randomUUID(),
      submitted = await service.submit(started.token, {
        revision,
        idempotencyKey: key,
      });
    assert.equal(submitted.application.status, 'PENDING_REVIEW');
    assert.equal(
      submitted.application.documentStatus,
      process.argv.includes('--phase3') ? 'READY' : 'FAILED',
    );
    const replay = await service.submit(started.token, {
      revision,
      idempotencyKey: key,
    });
    assert.equal(replay.idempotent, true);
    assert.equal(replay.versionId, submitted.versionId);
    await assert.rejects(
      service.save(started.token, { revision, currentStep: 1, data }),
    );
    await assert.rejects(
      client.query(
        "UPDATE trainee_application_versions SET form_data='{}' WHERE id=$1",
        [submitted.versionId],
      ),
      /immutable/,
    );
    assert.equal(
      (await client.query('SELECT count(*) FROM "user"')).rows[0].count,
      before,
    );
    process.env.VOLUNTEER_REGISTRATION_ENABLED = 'false';
    await assert.rejects(
      service.approve(
        {
          userId: randomUUID(),
          roles: [{ roleId: 10000, branchId: 'branch-a' }],
        },
        started.application.id,
        submitted.versionId,
        true,
      ),
    );
    process.env.VOLUNTEER_REGISTRATION_ENABLED = 'true';
    console.log(
      'PASS: Phase 2 real-DB draft restoration, private PNG clearance/signatures, scope binding, stale revisions, immutable/idempotent submission, no account or approval',
    );
    if (process.argv.includes('--phase3'))
      await require('./volunteer-phase3-local-checks.cjs')({
        client,
        db,
        root,
        users,
        service,
        integration,
        objects,
        started,
        submitted,
        data,
        sign,
        save,
        getRevision: () => revision,
      });
    if (process.argv.includes('--phase4'))
      await require('./volunteer-phase4-local-checks.cjs')({
        client,
        db,
        root,
        users,
        service,
        integration,
        objects,
        started,
      });
  } finally {
    global.fetch = originalFetch;
    if (documents) await documents.close();
  }
};
