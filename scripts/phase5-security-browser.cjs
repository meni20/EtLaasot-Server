// Supplemental real-browser/API/DEV checks. No mocks, test-schema resets,
// privileged evidence writes, or security bypasses. All mutations are through
// ordinary endpoints and target marked fictional applications only.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  { randomInt } = require('node:crypto'),
  { Client } = require('pg');
const { attest, file, dir, root } = require('./phase5-local.cjs'),
  { login, fillForm, click } = require('./phase5-browser.cjs');
const { chromium } = require(
  path.resolve(
    __dirname,
    '../../EtLaasot-Client/node_modules/@playwright/test',
  ),
);
const base = 'http://127.0.0.1:5185',
  api = 'http://127.0.0.1:3185';
let browser,
  step = 'setup';
const results = [];
const pass = (name) => {
  results.push({ name, status: 'PASS' });
  console.log('PASS: ' + name);
};
function identifier() {
  const b = String(randomInt(82000000, 89999999));
  const n = [...b].reduce((s, c, i) => {
    const x = Number(c) * ((i % 2) + 1);
    return s + (x > 9 ? x - 9 : x);
  }, 0);
  return b + ((10 - (n % 10)) % 10);
}
async function createCase(cfg, submitted) {
  const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    p = await context.newPage();
  p.setDefaultTimeout(45000);
  const nationalId = identifier();
  await p.goto(base + '/apply');
  await p.getByLabel('תעודת זהות חניך', { exact: true }).fill(nationalId);
  await p.getByRole('combobox', { name: /^סניף פעיל/ }).click();
  await p.getByRole('option', { name: new RegExp(cfg.branches[0]) }).click();
  const started = p.waitForResponse(
    (r) => r.url() === api + '/parent-applications/start',
  );
  await click(p, 'יצירת בקשה ללא חשבון');
  const response = await started;
  assert.ok(response.ok());
  const state = { nationalId, ...(await response.json()) };
  await click(p, 'שמרתי את קוד השחזור במקום בטוח');
  if (submitted) {
    await fillForm(p, nationalId, false);
    const done = p.waitForResponse(
      (r) =>
        r.url() === api + '/parent-applications/me/submit' &&
        r.request().method() === 'POST',
      { timeout: 120000 },
    );
    await click(p, 'שליחת הטופס');
    const result = await done;
    assert.ok(result.ok());
    const payload = await result.json();
    assert.equal(payload.application.documentStatus, 'READY');
    state.application = payload.application;
  }
  await context.close();
  return state;
}
async function run() {
  if (process.argv[2] !== '--execute') {
    console.log(
      'PLAN ONLY: --execute uses actual local APIs and fictional Phase 5 records to test private access, rejection, concurrency, recovery/revocation and rate limits.',
    );
    return;
  }
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8')),
    v = cfg.env;
  await attest(v);
  const fixtures = JSON.parse(
      fs.readFileSync(path.join(dir, 'fixtures.json'), 'utf8'),
    ),
    session = JSON.parse(
      fs.readFileSync(path.join(dir, 'applicant-session.json'), 'utf8'),
    );
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ac = await browser.newContext({ acceptDownloads: true }),
    admin = await ac.newPage();
  admin.setDefaultTimeout(35000);
  await login(admin, fixtures.users[0], fixtures);
  step = 'browser persistence and genuine reload';
  assert.equal(
    await admin.evaluate(() => localStorage.getItem('access_token')),
    null,
  );
  await admin.reload();
  assert.equal((await ac.request.get(api + '/auth/me')).status(), 200);
  pass(
    'Authentication survives browser reload using HttpOnly cookies; bearer credentials are absent from localStorage',
  );
  const c = new Client({
    host: v.DB_HOST,
    port: 5432,
    database: 'postgres',
    user: v.DB_USER,
    password: v.DB_PASS,
    ssl: {
      rejectUnauthorized: true,
      ca: fs.readFileSync(path.resolve(root, v.DB_SSL_CA_PATH), 'utf8'),
    },
  });
  await c.connect();
  try {
    await c.query('BEGIN READ ONLY');
    assert.equal(
      (
        await c.query(
          "SELECT current_database()='postgres' AND current_user='etlaasot_app' AND inet_server_addr()='2a05:d014:8ef:5902:b67d:7199:8fac:e6d0'::inet AND inet_server_port()=5432 AS ok",
        )
      ).rows[0].ok,
      true,
    );
    step = 'actual private object anonymous denial';
    const object = (
      await c.query(
        "SELECT storage_bucket,storage_path FROM public.trainee_application_evidence WHERE application_id=$1 AND kind='REGISTRATION_PDF'",
        [session.application.id],
      )
    ).rows[0];
    assert.ok(object);
    const anon = await browser.newContext();
    const url =
      v.SUPABASE_URL +
      '/storage/v1/object/public/' +
      object.storage_bucket +
      '/' +
      object.storage_path;
    assert.ok(
      [400, 401, 403, 404].includes((await anon.request.get(url)).status()),
    );
    const detail = await (
      await ac.request.get(
        api + `/parent-applications/admin/${session.application.id}`,
      )
    ).json();
    const pdf = detail.documents.find((d) => d.kind === 'REGISTRATION_PDF');
    assert.equal(
      (
        await anon.request.get(
          api +
            `/parent-applications/admin/${session.application.id}/documents/${pdf.id}`,
        )
      ).status(),
      401,
    );
    pass(
      'A real existing private PDF cannot be downloaded anonymously from Storage or the application',
    );
    step = 'backend RLS and immutable ACLs';
    const r = (
      await c.query(
        "SELECT bool_and(c.relrowsecurity AND row_security_active(c.oid) AND pg_get_userbyid(c.relowner)<>current_user AND NOT has_table_privilege(current_user,c.oid,'UPDATE') AND NOT has_table_privilege(current_user,c.oid,'DELETE')) AS ok FROM pg_class c WHERE c.relnamespace='public'::regnamespace AND c.relname IN ('trainee_application_versions','trainee_application_evidence','trainee_application_events','registration_form_versions','registration_form_documents','registration_form_history')",
      )
    ).rows[0];
    assert.equal(r.ok, true);
    pass(
      'Actual non-owner runtime role has active RLS and cannot mutate immutable evidence/version/history tables',
    );
    await c.query('COMMIT');
  } finally {
    await c.end();
  }
  step = 'administrator rejection through real browser';
  const list = await (
    await ac.request.get(
      api +
        `/parent-applications/admin?branchId=${fixtures.branches[0]}&page=1`,
    )
  ).json();
  const pending = list.rows.filter(
    (x) => x.status === 'PENDING_REVIEW' && x.documentStatus === 'READY',
  );
  const createdCases = [];
  while (pending.length < 2) {
    step = 'create real browser-submitted security fixture';
    const created = await createCase(cfg, true);
    createdCases.push(created);
    pending.push(created.application);
    fs.writeFileSync(
      path.join(dir, 'security-created-cases.json'),
      JSON.stringify(createdCases),
      { mode: 0o600 },
    );
  }
  const reject = pending[0],
    race = pending[1];
  const reviewed = await (
    await ac.request.get(api + `/parent-applications/admin/${reject.id}`)
  ).json();
  assert.ok(reviewed.versions[0].data.trainee.familyName.includes('Phase5'));
  await admin.goto(base + '/parent-applications-admin');
  await admin
    .getByRole('button', { name: new RegExp(reject.id.slice(0, 8)) })
    .click();
  await admin
    .getByLabel('סיבת החזרה לתיקון או דחייה')
    .fill('Phase5 fictional rejection test');
  const rejected = admin.waitForResponse(
    (r) => r.url() === api + `/parent-applications/admin/${reject.id}/reject`,
  );
  await click(admin, 'דחיית בקשה');
  assert.ok((await rejected).ok());
  assert.equal(
    (
      await (
        await ac.request.get(api + `/parent-applications/admin/${reject.id}`)
      ).json()
    ).application.status,
    'REJECTED',
  );
  assert.equal(
    (
      await ac.request.post(
        api + `/parent-applications/admin/${reject.id}/approve`,
        {
          headers: { Origin: base },
          data: {
            expectedVersionId: reviewed.versions[0].id,
            identityVerified: true,
          },
        },
      )
    ).status(),
    409,
  );
  pass(
    'Real branch administrator rejects a submitted application; rejected applications cannot be approved',
  );
  step = 'concurrent approval account uniqueness';
  const racing = await (
    await ac.request.get(api + `/parent-applications/admin/${race.id}`)
  ).json();
  assert.ok(racing.versions[0].data.trainee.familyName.includes('Phase5'));
  const replies = await Promise.all([
    ac.request.post(api + `/parent-applications/admin/${race.id}/approve`, {
      headers: { Origin: base },
      data: {
        expectedVersionId: racing.versions[0].id,
        identityVerified: true,
      },
    }),
    ac.request.post(api + `/parent-applications/admin/${race.id}/approve`, {
      headers: { Origin: base },
      data: {
        expectedVersionId: racing.versions[0].id,
        identityVerified: true,
      },
    }),
  ]);
  assert.deepEqual(replies.map((r) => r.status()).sort(), [201, 409]);
  const approved = await replies.find((r) => r.status() === 201).json();
  assert.ok(approved.userId && approved.temporaryPassword);
  const after = await (
    await ac.request.get(api + `/parent-applications/admin/${race.id}`)
  ).json();
  assert.equal(after.application.status, 'APPROVED');
  pass(
    'Two genuine concurrent approval requests create one trainee account and return one temporary password response',
  );
  step = 'secure recovery and credential rotation in actual browser';
  let recoverySource = session;
  const check = await ac.request.get(api + '/parent-applications/me', {
    headers: { 'X-Applicant-Session': session.sessionToken },
  });
  if (check.status() !== 200) {
    recoverySource = createdCases[0] ?? (await createCase(cfg, false));
    fs.writeFileSync(
      path.join(dir, 'recovery-case.json'),
      JSON.stringify(recoverySource),
      { mode: 0o600 },
    );
  }
  const pc = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    parent = await pc.newPage();
  parent.setDefaultTimeout(30000);
  await parent.goto(base + '/apply');
  await parent
    .getByLabel('קוד שחזור פרטי', { exact: true })
    .fill(recoverySource.recoveryCode);
  const recovered = parent.waitForResponse(
    (r) => r.url() === api + '/parent-applications/recover',
  );
  await click(parent, 'שחזור גישה מאובטח');
  const recoveryResponse = await recovered;
  assert.ok(recoveryResponse.ok());
  const recovery = await recoveryResponse.json();
  const old = await pc.request.get(api + '/parent-applications/me', {
    headers: { 'X-Applicant-Session': recoverySource.sessionToken },
  });
  assert.equal(old.status(), 401);
  assert.equal(
    await parent.evaluate(() => localStorage.getItem('access_token')),
    null,
  );
  await click(parent, 'שמרתי את קוד השחזור במקום בטוח');
  const revoked = parent.waitForResponse(
    (r) => r.url() === api + '/parent-applications/session/revoke',
  );
  await click(parent, 'סיום וביטול הגישה לבקשה במכשיר זה');
  assert.ok((await revoked).ok());
  assert.equal(
    (
      await pc.request.get(api + '/parent-applications/me', {
        headers: { 'X-Applicant-Session': recovery.sessionToken },
      })
    ).status(),
    401,
  );
  assert.equal(
    (
      await pc.request.post(api + '/parent-applications/recover', {
        headers: { Origin: base },
        data: { recoveryCode: recovery.recoveryCode },
      })
    ).status(),
    401,
  );
  pass(
    'Real browser recovery rotates credentials; old credentials fail and revocation also invalidates recovery',
  );
  step = 'concurrent identity uniqueness and byte validation';
  const freshId = identifier(),
    one = await browser.newContext(),
    two = await browser.newContext();
  const starts = await Promise.all([
    one.request.post(api + '/parent-applications/start', {
      headers: { Origin: base },
      data: { identifier: freshId, branchId: fixtures.branches[1] },
    }),
    two.request.post(api + '/parent-applications/start', {
      headers: { Origin: base },
      data: { identifier: freshId, branchId: fixtures.branches[1] },
    }),
  ]);
  assert.deepEqual(starts.map((r) => r.status()).sort(), [201, 409]);
  const created = await starts.find((r) => r.status() === 201).json();
  fs.writeFileSync(
    path.join(dir, 'security-created-session.json'),
    JSON.stringify({ nationalId: freshId, ...created }),
    { mode: 0o600 },
  );
  pass('Concurrent starts for one fictional identity produce one application');
  const invalid = await one.request.post(
    api + '/parent-applications/me/attachments/PHYSICIAN_SUMMARY',
    {
      headers: { Origin: base, 'X-Applicant-Session': created.sessionToken },
      multipart: {
        revision: '0',
        file: {
          name: 'forged.pdf',
          mimeType: 'application/pdf',
          buffer: Buffer.from('not a real medical file'),
        },
      },
    },
  );
  assert.equal(invalid.status(), 400);
  pass('A forged medical file is rejected from its actual bytes');
  step = 'real shared database rate limits';
  const probe = identifier(),
    attempts = await Promise.all(
      Array.from({ length: 9 }, (_, i) =>
        (i % 2 ? one : two).request.post(api + '/auth/identify', {
          headers: { Origin: base },
          data: { identifier: probe },
        }),
      ),
    );
  assert.ok(attempts.some((r) => r.status() === 429));
  for (const r of attempts.filter((r) => r.status() === 201)) {
    assert.deepEqual(Object.keys(await r.json()), ['next']);
  }
  pass(
    'Concurrent public discovery is rate-limited by the real shared database and exposes only the next step',
  );
  step = 'Documents internal authentication';
  assert.equal(
    (
      await one.request.post(
        'http://127.0.0.1:3285/internal/documents/render',
        { data: {} },
      )
    ).status(),
    401,
  );
  assert.equal(
    (
      await one.request.post(
        'http://127.0.0.1:3285/internal/documents/render',
        { headers: { 'X-Internal-Api-Key': '0'.repeat(64) }, data: {} },
      )
    ).status(),
    401,
  );
  pass(
    'Actual local Documents rejects missing and incorrect internal authentication',
  );
  fs.writeFileSync(
    path.join(dir, 'security-results.json'),
    JSON.stringify({ results, allPassed: true }, null, 2),
  );
}
if (require.main === module)
  run()
    .catch((e) => {
      console.error(
        JSON.stringify({
          failedAt: step,
          errorType: e.name,
          errorCode: e.code,
        }),
      );
      results.push({ name: step, status: 'FAIL' });
      fs.writeFileSync(
        path.join(dir, 'security-results.json'),
        JSON.stringify({ results, allPassed: false }, null, 2),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await browser?.close();
    });
