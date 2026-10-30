module.exports = async ({
  client,
  db,
  root,
  users,
  service,
  integration,
  objects,
  started,
}) => {
  const assert = require('node:assert/strict'),
    { randomUUID, randomBytes } = require('node:crypto'),
    fs = require('node:fs'),
    path = require('node:path');
  const {
    AdmissionRepository,
  } = require('../src/modules/parent-admission/admission.repository');
  const { verifyPassword } = require('../src/modules/auth/password.util');
  const {
    getNationalIdDetails,
  } = require('../src/modules/user/national-id.util');
  const account = (await client.query('SELECT id FROM "user" LIMIT 1')).rows[0]
    .id;
  const actor = {
      userId: account,
      roles: [{ roleId: 10000, branchId: 'branch-a' }],
    },
    superAdmin = { userId: account, roles: [{ roleId: 10001 }] },
    foreign = {
      userId: account,
      roles: [{ roleId: 10000, branchId: 'branch-b' }],
    };
  const signature = fs.readFileSync(
    path.join(root, '../EtLaasot-Documents/mock/signature.png'),
  );
  async function signAndSubmit(token) {
    let {
      data,
      application: { revision },
    } = await service.me(token);
    for (const purpose of ['VOLUNTEER_AGREEMENT', 'CONFIDENTIALITY']) {
      const { documentId, contentHash, signedAt, agreementVersion } =
        await service.upload(token, revision, 'SIGNATURE', signature, purpose);
      data.signatures = {
        ...data.signatures,
        [purpose]: { documentId, contentHash, signedAt, agreementVersion },
      };
      ({
        data,
        application: { revision },
      } = await service.save(token, { data, revision, currentStep: 5 }));
    }
    const result = await service.submit(token, {
      revision,
      idempotencyKey: randomUUID(),
    });
    assert.equal(result.application.documentStatus, 'READY');
    return result;
  }
  // Phase 3 left this synthetic adult male application in corrections. Existing clearance remains private.
  const submitted = await signAndSubmit(started.token),
    id = started.application.id,
    versionId = submitted.versionId;
  const detail = await service.detail(actor, id);
  assert.equal(detail.versions[0].data.volunteer.phone, '0520000000');
  assert.ok(detail.history.some((e) => e.reason === 'תיקון'));
  for (const doc of detail.documents)
    assert.ok((await service.document(actor, id, doc.id)).bytes.length > 0);
  await assert.rejects(service.detail(foreign, id));
  await assert.rejects(service.approve(foreign, id, versionId, true));
  await assert.rejects(service.approve(actor, id, randomUUID(), true));
  await assert.rejects(
    Promise.resolve().then(() => service.approve(actor, id, versionId, false)),
  );
  await assert.rejects(
    service.review(actor, id, 'REJECTED', 'stale', randomUUID()),
  );
  await assert.rejects(
    Promise.resolve().then(() =>
      service.review(actor, id, 'REJECTED', ' ', versionId),
    ),
  );
  const before = Number(
      (await client.query('SELECT count(*) FROM "user"')).rows[0].count,
    ),
    rolesBefore = Number(
      (await client.query('SELECT count(*) FROM user_roles')).rows[0].count,
    );
  const unchanged = async () => {
    assert.equal(
      Number((await client.query('SELECT count(*) FROM "user"')).rows[0].count),
      before,
    );
    assert.equal(
      Number(
        (await client.query('SELECT count(*) FROM user_roles')).rows[0].count,
      ),
      rolesBefore,
    );
    assert.equal(
      (await service.me(started.token)).application.status,
      'PENDING_REVIEW',
    );
  };
  const repo = service.repo,
    originalEvidence = repo.evidence.bind(repo);
  for (const kind of ['SIGNATURE', 'POLICE_CLEARANCE', 'REGISTRATION_PDF']) {
    repo.evidence = async (...args) =>
      (await originalEvidence(...args)).filter((d) => d.kind !== kind);
    try {
      await assert.rejects(service.approve(actor, id, versionId, true));
      await unchanged();
    } finally {
      repo.evidence = originalEvidence;
    }
  }
  for (const mismatch of [
    { versionId: randomUUID() },
    { contentHash: 'f'.repeat(64) },
    { templateVersion: 'parent-registration/v1' },
    { registrationType: 'TRAINEE' },
    { verifiedAt: null },
    { sourceChecksum: 'f'.repeat(64) },
  ]) {
    repo.evidence = async (...args) =>
      (await originalEvidence(...args)).map((d) =>
        d.kind === 'REGISTRATION_PDF'
          ? { ...d.get({ plain: true }), ...mismatch }
          : d,
      );
    try {
      await assert.rejects(service.approve(actor, id, versionId, true));
      await unchanged();
    } finally {
      repo.evidence = originalEvidence;
    }
  }
  const stored = (
    await client.query(
      'SELECT id,kind,version_id,storage_path FROM trainee_application_evidence WHERE application_id=$1',
      [id],
    )
  ).rows;
  for (const kind of ['SIGNATURE', 'POLICE_CLEARANCE', 'REGISTRATION_PDF']) {
    const file = stored.find(
        (d) =>
          d.kind === kind &&
          (kind === 'REGISTRATION_PDF'
            ? d.version_id === versionId
            : kind === 'SIGNATURE'
              ? d.id ===
                detail.versions[0].data.signatures.VOLUNTEER_AGREEMENT
                  .documentId
              : d.id === detail.versions[0].data.policeClearanceDocumentId),
      ),
      bytes = objects.get(file.storage_path);
    objects.set(file.storage_path, Buffer.from('corrupted private evidence'));
    try {
      await assert.rejects(service.approve(actor, id, versionId, true));
      await unchanged();
    } finally {
      objects.set(file.storage_path, bytes);
    }
  }
  await client.query('UPDATE branch SET "isActive"=false WHERE id=$1', [
    'branch-a',
  ]);
  try {
    await assert.rejects(service.approve(actor, id, versionId, true));
    await unchanged();
  } finally {
    await client.query('UPDATE branch SET "isActive"=true WHERE id=$1', [
      'branch-a',
    ]);
  }
  const originalAssign = users.userRoleService.asignRoleToUser;
  users.userRoleService.asignRoleToUser = async () => {
    throw Error('synthetic role failure');
  };
  try {
    await assert.rejects(service.approve(actor, id, versionId, true));
    await unchanged();
  } finally {
    users.userRoleService.asignRoleToUser = originalAssign;
  }
  const originalEvent = repo.event.bind(repo);
  repo.event = async (...args) => {
    if (args[1] === 'APPROVED') throw Error('synthetic audit failure');
    return originalEvent(...args);
  };
  try {
    await assert.rejects(service.approve(actor, id, versionId, true));
    await unchanged();
  } finally {
    repo.event = originalEvent;
  }
  const [a, b] = await Promise.all([
    service.approve(actor, id, versionId, true),
    service.approve(superAdmin, id, versionId, true),
  ]);
  const first = [a, b].find((x) => x.temporaryPassword),
    replay = [a, b].find((x) => x.idempotent);
  assert.ok(first && replay);
  assert.equal(first.userId, replay.userId);
  assert.equal(first.temporaryPassword.length, 18);
  assert.equal(replay.temporaryPassword, undefined);
  assert.equal(
    new Date(first.temporaryPasswordExpiresAt).getTime() > Date.now(),
    true,
  );
  const user = (
    await client.query('SELECT * FROM "user" WHERE id=$1', [first.userId])
  ).rows[0];
  assert.equal(user.phone_number, '0520000000');
  assert.equal(user.name, 'בדיקה מקומית');
  assert.equal(user.email, 'fictional@example.invalid');
  assert.equal(user.gender, 'male');
  assert.equal(user.address, 'כתובת בדיקה');
  assert.equal(user.branchId, 'branch-a');
  assert.equal(
    (
      await client.query(
        'SELECT date_of_birth::text AS value FROM "user" WHERE id=$1',
        [first.userId],
      )
    ).rows[0].value,
    '2000-01-01',
  );
  assert.equal(user.shirt_size, 'M');
  assert.equal(user.must_change_password, true);
  assert.equal(user.is_active, true);
  assert.notEqual(user.password_hash, first.temporaryPassword);
  assert.equal(
    await verifyPassword(user.password_hash, first.temporaryPassword),
    true,
  );
  assert.ok(
    user.national_id_encrypted &&
      !user.national_id_encrypted.includes('000000018'),
  );
  assert.equal(
    user.national_id_hash,
    getNationalIdDetails('000000018').nationalIdHash,
  );
  assert.deepEqual(
    (
      await client.query(
        'SELECT "roleId","resourceId" FROM user_roles WHERE "userId"=$1',
        [first.userId],
      )
    ).rows,
    [{ roleId: 1, resourceId: 'branch-a' }],
  );
  assert.equal(
    Number((await client.query('SELECT count(*) FROM "user"')).rows[0].count),
    before + 1,
  );
  assert.equal(
    (
      await client.query(
        'SELECT provisioned_user_id FROM trainee_applications WHERE id=$1',
        [id],
      )
    ).rows[0].provisioned_user_id,
    first.userId,
  );
  assert.equal(
    (await service.approve(actor, id, versionId, true)).temporaryPassword,
    undefined,
  );
  const AuthService = require('../src/modules/auth/auth.service').default;
  const Branch =
    require('../src/modules/branch/entities/branch.entity').default;
  delete process.env.RECAPTCHA_SECRET_KEY;
  const auth = new AuthService(
    db,
    users.userRoleService,
    users,
    { getAllBranches: () => Branch.findAll() },
    { sign: () => 'synthetic-local-jwt' },
  );
  const login = await auth.login('000000018', first.temporaryPassword);
  assert.equal(login.mustChangePassword, true);
  assert.equal(login.roles[0].roleId, 1);
  assert.equal(login.activeBranch, 'branch-a');
  await client.query(
    'UPDATE "user" SET temporary_password_expires_at=$1 WHERE id=$2',
    [new Date(Date.now() - 1000), first.userId],
  );
  await assert.rejects(auth.login('000000018', first.temporaryPassword));
  await client.query(
    'UPDATE "user" SET temporary_password_expires_at=$1 WHERE id=$2',
    [first.temporaryPasswordExpiresAt, first.userId],
  );
  await auth.changePassword(
    first.userId,
    first.temporaryPassword,
    'LocalChanged!4962',
    'LocalChanged!4962',
  );
  const changed = (
    await client.query(
      'SELECT must_change_password,temporary_password_expires_at FROM "user" WHERE id=$1',
      [first.userId],
    )
  ).rows[0];
  assert.equal(changed.must_change_password, false);
  assert.equal(changed.temporary_password_expires_at, null);
  await assert.rejects(auth.login('000000018', first.temporaryPassword));
  assert.equal(
    (await auth.login('000000018', 'LocalChanged!4962')).mustChangePassword,
    false,
  );
  await assert.rejects(
    service.review(actor, id, 'REJECTED', 'cannot reject approved', versionId),
  );
  assert.equal(
    (
      await client.query(
        "SELECT count(*) FROM trainee_application_events WHERE application_id=$1 AND action='APPROVED'",
        [id],
      )
    ).rows[0].count,
    '1',
  );
  // Rejected applications have an immutable decision and never receive an account.
  const rejected = await service.start('000000026', 'branch-a', 'VOLUNTEER');
  let snap = await service.me(started.token),
    data = structuredClone(snap.data);
  data.volunteer.nationalId = '000000026';
  delete data.signatures;
  delete data.policeClearanceDocumentId;
  let saved = await service.save(rejected.token, {
    data,
    revision: 0,
    currentStep: 5,
  });
  const clearance = await service.upload(
    rejected.token,
    saved.application.revision,
    'POLICE_CLEARANCE',
    signature,
  );
  await service.save(rejected.token, {
    data: { ...saved.data, policeClearanceDocumentId: clearance.documentId },
    revision: saved.application.revision,
    currentStep: 5,
  });
  const rejectVersion = await signAndSubmit(rejected.token);
  await service.review(
    superAdmin,
    rejected.application.id,
    'REJECTED',
    'סיבת דחייה מקומית',
    rejectVersion.versionId,
  );
  await assert.rejects(
    service.approve(
      actor,
      rejected.application.id,
      rejectVersion.versionId,
      true,
    ),
  );
  assert.equal(
    Number((await client.query('SELECT count(*) FROM "user"')).rows[0].count),
    before + 1,
  );
  const history = (await service.detail(actor, rejected.application.id))
    .history;
  assert.ok(
    history.some(
      (e) =>
        e.reason === 'סיבת דחייה מקומית' &&
        e.versionId === rejectVersion.versionId,
    ),
  );
  await assert.rejects(
    client.query(
      'UPDATE trainee_application_events SET reason=$1 WHERE id=$2',
      ['tamper', history[0].id],
    ),
    /immutable/,
  );
  // SQL filters apply before pagination; the name search never examines encrypted identity fields.
  for (let i = 0; i < 27; i++)
    await client.query(
      "INSERT INTO trainee_applications(id,national_id_hash,national_id_encrypted,branch_id,registration_type,draft_data) VALUES($1,$2,'fictional','branch-a','VOLUNTEER',$3::jsonb)",
      [
        randomUUID(),
        randomBytes(32).toString('hex'),
        JSON.stringify({
          volunteer: { firstName: 'עמודבדיקה', lastName: String(i) },
        }),
      ],
    );
  const p1 = await service.list(
      actor,
      'branch-a',
      1,
      'VOLUNTEER',
      'DRAFT',
      'עמודבדיקה',
    ),
    p2 = await service.list(
      actor,
      'branch-a',
      2,
      'VOLUNTEER',
      'DRAFT',
      'עמודבדיקה',
    );
  assert.equal(p1.count, 27);
  assert.equal(p1.rows.length, 25);
  assert.equal(p2.rows.length, 2);
  assert.equal(new Set([...p1.rows, ...p2.rows].map((r) => r.id)).size, 27);
  assert.equal(
    (await service.list(actor, 'branch-a', 1, 'TRAINEE', 'DRAFT', 'עמודבדיקה'))
      .count,
    0,
  );
  assert.equal(
    (await service.list(superAdmin, 'branch-a', 1, 'ALL', 'DRAFT', 'עמודבדיקה'))
      .count,
    27,
  );
  await assert.rejects(service.list(foreign, 'branch-a', 1, 'ALL'));
  process.env.VOLUNTEER_REGISTRATION_ENABLED = 'false';
  try {
    await assert.rejects(service.list(actor, 'branch-a', 1, 'VOLUNTEER'));
    await assert.rejects(service.list(actor, 'branch-a', 1, 'ALL'));
    await assert.rejects(service.detail(actor, id));
  } finally {
    process.env.VOLUNTEER_REGISTRATION_ENABLED = 'true';
  }
  console.log(
    'PASS: local volunteer review/detail/evidence, SQL filtering/pagination, stale decisions, rejection, branch/super-admin authorization, all approval blockers, role/audit rollback, concurrent idempotent approval, encrypted identity/profile/phone, one-time 18-character password and no accounts before approval',
  );
};
