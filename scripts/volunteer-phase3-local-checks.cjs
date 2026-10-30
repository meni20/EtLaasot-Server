module.exports = async ({
  client,
  db,
  service,
  integration,
  objects,
  started,
  submitted,
  users,
  getRevision,
}) => {
  const assert = require('node:assert/strict'),
    { randomUUID } = require('node:crypto');
  const {
    readVolunteerData,
  } = require('../src/modules/parent-admission/volunteer.validation');
  const {
    AdmissionRepository,
  } = require('../src/modules/parent-admission/admission.repository');
  const {
    ApplicationEvidence,
  } = require('../src/modules/parent-admission/admission.entities');
  const count = () =>
    client
      .query(
        "SELECT count(*) FROM trainee_application_evidence WHERE application_id=$1 AND kind='REGISTRATION_PDF'",
        [started.application.id],
      )
      .then((r) => Number(r.rows[0].count));
  assert.equal(await count(), 1);
  const current = await service.applicantPdf(started.token);
  assert.equal(current.bytes.subarray(0, 5).toString(), '%PDF-');
  await assert.rejects(service.applicantPdf('x'.repeat(43)));
  const account = (await client.query('SELECT id FROM "user" LIMIT 1')).rows[0]
    .id;
  const actor = {
      userId: account,
      roles: [{ roleId: 10000, branchId: 'branch-a' }],
    },
    foreign = { ...actor, roles: [{ roleId: 10000, branchId: 'other' }] };
  const old = (
    await client.query(
      "SELECT id,storage_path,checksum,template_version,source_checksum FROM trainee_application_evidence WHERE application_id=$1 AND kind='REGISTRATION_PDF'",
      [started.application.id],
    )
  ).rows[0];
  assert.equal(old.template_version, 'volunteer-registration/v1');
  assert.equal(old.source_checksum.length, 64);
  assert.equal(
    (
      await service.document(actor, started.application.id, old.id)
    ).bytes.equals(current.bytes),
    true,
  );
  await assert.rejects(
    service.document(foreign, started.application.id, old.id),
  );
  await Promise.all([
    service.retry(started.token),
    service.retry(started.token),
  ]);
  assert.equal(await count(), 1);
  const saved = objects.get(old.storage_path);
  objects.set(old.storage_path, Buffer.from('tampered PDF'));
  await assert.rejects(service.applicantPdf(started.token));
  await assert.rejects(service.retry(started.token));
  assert.equal(
    (await service.me(started.token)).application.documentStatus,
    'FAILED',
  );
  objects.set(old.storage_path, saved);
  await service.retry(started.token);
  assert.equal(
    (await service.me(started.token)).application.documentStatus,
    'READY',
  );
  await service.review(
    actor,
    started.application.id,
    'CHANGES_REQUESTED',
    'תיקון מקומי בלבד',
    submitted.versionId,
  );
  const snapshot = await service.me(started.token);
  let data = snapshot.data,
    revision = snapshot.application.revision;
  data.questionnaire.motivation = 'תיקון נוסף לבדיקת גרסה חדשה';
  ({
    data,
    application: { revision },
  } = await service.save(started.token, { data, revision, currentStep: 5 }));
  const fs = require('node:fs'),
    path = require('node:path');
  const bytes = fs.readFileSync(
    path.resolve('../EtLaasot-Documents/mock/signature.png'),
  );
  for (const purpose of ['VOLUNTEER_AGREEMENT', 'CONFIDENTIALITY']) {
    const { documentId, contentHash, signedAt, agreementVersion } =
      await service.upload(
        started.token,
        revision,
        'SIGNATURE',
        bytes,
        purpose,
      );
    data.signatures = {
      ...data.signatures,
      [purpose]: { documentId, contentHash, signedAt, agreementVersion },
    };
    ({
      data,
      application: { revision },
    } = await service.save(started.token, { data, revision, currentStep: 5 }));
  }
  const url = process.env.REGISTRATION_DOCUMENTS_URL;
  process.env.REGISTRATION_DOCUMENTS_URL = 'http://127.0.0.1:1';
  const next = await service.submit(started.token, {
    revision,
    idempotencyKey: randomUUID(),
  });
  assert.equal(next.application.documentStatus, 'FAILED');
  process.env.REGISTRATION_DOCUMENTS_URL = url;
  // Concurrent retries run without holding the owner lock across rendering.
  await Promise.all([
    service.retry(started.token),
    service.retry(started.token),
  ]);
  assert.equal(await count(), 2);
  const restored = await service.me(started.token);
  assert.equal(restored.application.documentStatus, 'READY');
  const latest = await service.applicantPdf(started.token);
  assert.ok(latest.bytes.length > 1000);
  assert.equal(
    (
      await service.document(actor, started.application.id, old.id)
    ).bytes.equals(saved),
    true,
  );
  // Historical retry must not mark a newer pending version READY.
  await service.review(
    actor,
    started.application.id,
    'CHANGES_REQUESTED',
    'תיקון',
    next.versionId,
  );
  await integration.generateVolunteer(
    started.application.id,
    submitted.versionId,
  );
  assert.equal(
    (await service.me(started.token)).application.documentStatus,
    'PENDING',
  );
  const failed = (
    await client.query(
      "SELECT count(*) FROM trainee_application_events WHERE application_id=$1 AND action='PDF_FAILED' AND version_id=$2",
      [started.application.id, next.versionId],
    )
  ).rows[0].count;
  assert.ok(Number(failed) > 0);
  await assert.rejects(
    client.query(
      'UPDATE trainee_application_evidence SET checksum=$1 WHERE id=$2',
      ['a'.repeat(64), old.id],
    ),
    /immutable/,
  );
  assert.equal(
    (await client.query('SELECT count(*) FROM "user"')).rows[0].count,
    '1',
  );
  console.log(
    'PASS: real Documents HTTP + PostgreSQL PDF metadata, current/history retrieval, checksum failure, branch/session isolation, concurrent retry, correction/resubmission, failure recovery and no accounts',
  );
};
