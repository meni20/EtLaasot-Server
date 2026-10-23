// Verifies the final compiled pool/auth guards and PDF audit records through a
// fresh genuine one-parent renewal. No fixtures/evidence states are fabricated.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  { Client } = require('pg');
const { attest, file, dir, root } = require('./phase5-local.cjs'),
  { login, fillForm, click } = require('./phase5-browser.cjs'),
  {
    stopDocuments,
    restoreDocuments,
    submit,
    openForm,
    approve,
  } = require('./phase5-renewal-browser.cjs');
const { chromium } = require(
  path.resolve(
    __dirname,
    '../../EtLaasot-Client/node_modules/@playwright/test',
  ),
);
const base = 'http://127.0.0.1:5185',
  api = 'http://127.0.0.1:3185';
let browser,
  page,
  step = 'setup';
async function run() {
  if (process.argv[2] !== '--execute') {
    console.log(
      'PLAN ONLY: --execute creates a marked nonblocking renewal through the real UI and checks final PDF failure/success audit records.',
    );
    return;
  }
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8')),
    v = cfg.env;
  await attest(v);
  const fixtures = JSON.parse(
    fs.readFileSync(path.join(dir, 'fixtures.json'), 'utf8'),
  );
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ac = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    }),
    admin = await ac.newPage();
  await login(admin, fixtures.users[0], fixtures);
  const tc = await browser.newContext({
      viewport: { width: 390, height: 844 },
      acceptDownloads: true,
    }),
    trainee = await tc.newPage();
  await login(trainee, fixtures.users[2], fixtures);
  page = admin;
  step = 'real nonblocking request';
  await admin.goto(base + '/parent-registration');
  await click(admin, 'בקשת חידוש אישי');
  const dialog = admin.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'חניך/ה מהסניף' }).click();
  await admin
    .locator(`[role=option][data-value="${fixtures.users[2].id}"]`)
    .click();
  await dialog
    .getByRole('checkbox', { name: 'בקשה חוסמת עד לאישור', exact: true })
    .uncheck();
  await dialog
    .getByLabel(/^סיבה/)
    .fill('Phase5 final audit and transport verification');
  const requested = admin.waitForResponse(
    (r) => r.url().endsWith('/renew') && r.request().method() === 'POST',
  );
  await dialog
    .getByRole('button', { name: 'אישור פעולה', exact: true })
    .click();
  const r = await requested;
  assert.ok(r.ok());
  const form = await r.json();
  page = trainee;
  step = 'real one-parent form and failure audit';
  await trainee.goto(base + '/parent-registration');
  await fillForm(trainee, fixtures.users[2].nationalId, false);
  stopDocuments();
  const failed = await submit(trainee, '/parent-registration/me/submit');
  assert.equal(failed.body.form.documentStatus, 'FAILED');
  await restoreDocuments();
  page = admin;
  step = 'real retry, audit and approval';
  await openForm(admin, form.id);
  const retried = admin.waitForResponse(
    (r) => r.url().endsWith('/pdf/retry') && r.request().method() === 'POST',
  );
  await click(admin, 'ניסיון נוסף להפקת PDF');
  assert.ok((await retried).ok());
  const ready = await (
    await ac.request.get(api + `/parent-registration/admin/forms/${form.id}`)
  ).json();
  assert.equal(ready.form.documentStatus, 'READY');
  assert.equal(
    ready.documents.filter((d) => d.kind === 'REGISTRATION_PDF').length,
    1,
  );
  const download = admin.waitForEvent('download');
  await click(admin, 'הורדת PDF הרישום פרטי');
  await (await download).saveAs(path.join(dir, 'final-one-parent.pdf'));
  await approve(admin);
  assert.equal(
    (
      await tc.request.get(
        api + '/event/get-all-events?branchId=' + fixtures.branches[0],
      )
    ).status(),
    200,
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
    const rows = (
      await c.query(
        'SELECT action,actor_uuid FROM public.registration_form_history WHERE form_id=$1 AND action IN ($2,$3)',
        [form.id, 'PDF_FAILED', 'PDF_GENERATED'],
      )
    ).rows;
    assert.ok(
      rows.some(
        (r) =>
          r.action === 'PDF_FAILED' && r.actor_uuid === fixtures.users[2].id,
      ),
    );
    assert.ok(
      rows.some(
        (r) =>
          r.action === 'PDF_GENERATED' && r.actor_uuid === fixtures.users[0].id,
      ),
    );
    await c.query('COMMIT');
  } finally {
    await c.end();
  }
  await trainee.goto(base + '/parent-registration');
  await trainee.setViewportSize({ width: 320, height: 844 });
  await trainee
    .getByRole('heading', { name: 'רישום הורים לפעילויות' })
    .waitFor();
  assert.equal(
    await trainee.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  await trainee.screenshot({
    path: path.join(dir, 'final-mobile-320.png'),
    fullPage: true,
    mask: [trainee.locator('input[type=password]')],
  });
  fs.writeFileSync(
    path.join(dir, 'final-results.json'),
    JSON.stringify(
      {
        allPassed: true,
        formId: form.id,
        pdfFailureAudit: true,
        pdfSuccessAudit: true,
        originalSessionStillWorks: true,
        noHorizontalOverflow320: true,
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: Final compiled guards, real outage/retry PDF audit, one-parent approval, session continuity and 320px layout.',
  );
}
if (require.main === module)
  run()
    .catch(async (e) => {
      console.error(
        JSON.stringify({
          failedAt: step,
          errorType: e.name,
          errorCode: e.code,
        }),
      );
      if (page)
        await page
          .screenshot({
            path: path.join(dir, 'final-failure.png'),
            fullPage: true,
            mask: [page.locator('input[type=password]')],
          })
          .catch(() => {});
      fs.writeFileSync(
        path.join(dir, 'final-results.json'),
        JSON.stringify({ allPassed: false, failedAt: step }),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await restoreDocuments();
      await browser?.close();
    });
