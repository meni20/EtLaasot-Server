// Continuation of the real new-trainee browser acceptance. Uses only the
// marked fictional users/branches; API probes use genuine browser cookies.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  { execFileSync, spawn } = require('node:child_process');
const { attest, file, dir, root } = require('./phase5-local.cjs');
const { login, fillForm, click, select, ink } = require('./phase5-browser.cjs');
const { chromium } = require(
  path.resolve(
    __dirname,
    '../../EtLaasot-Client/node_modules/@playwright/test',
  ),
);
const api = 'http://127.0.0.1:3185',
  base = 'http://127.0.0.1:5185';
let browser,
  page,
  step = 'setup',
  documentsStopped = false;
const results = [];
const pass = (name) => {
  results.push({ name, status: 'PASS' });
  console.log('PASS: ' + name);
  fs.writeFileSync(
    path.join(dir, 'renewal-results.json'),
    JSON.stringify({ results, fullAcceptance: false }, null, 2),
  );
};
async function restoreDocuments() {
  if (!documentsStopped) return;
  const log = fs.openSync(path.join(dir, 'documents-retry.log'), 'a');
  const p = spawn(process.execPath, ['scripts/phase5-local.cjs', 'documents'], {
    cwd: root,
    stdio: ['ignore', log, log],
    detached: true,
    windowsHide: true,
  });
  p.unref();
  fs.closeSync(log);
  for (let i = 0; i < 90; i++) {
    try {
      if ((await fetch('http://127.0.0.1:3285/health')).ok) {
        documentsStopped = false;
        return;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw Error('Documents restart failed');
}
function stopDocuments() {
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '$p=Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort 3285 -State Listen; $c=Get-CimInstance Win32_Process -Filter "ProcessId=$($p.OwningProcess)"; $parent=Get-CimInstance Win32_Process -Filter "ProcessId=$($c.ParentProcessId)"; if($parent.CommandLine -notmatch \'phase5-local.cjs documents\'){throw \'Refusing to stop an unverified process\'}; Stop-Process -Id $p.OwningProcess',
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  documentsStopped = true;
}
async function submit(p, pathName) {
  const response = p.waitForResponse(
    (r) => r.url() === api + pathName && r.request().method() === 'POST',
    { timeout: 120000 },
  );
  await click(p, 'שליחת הטופס');
  const r = await response;
  assert.ok(r.ok(), 'Submitted form rejected');
  return { body: await r.json(), payload: r.request().postDataJSON() };
}
async function openForm(admin, formId) {
  await admin.goto(base + '/parent-registration');
  await admin
    .getByRole('button', { name: 'פתיחת טופס', exact: true })
    .first()
    .click();
  await admin
    .getByRole('heading', { name: 'בדיקת טופס', exact: true })
    .waitFor();
  const response = await admin
    .context()
    .request.get(api + `/parent-registration/admin/forms/${formId}`);
  assert.ok(response.ok());
  return response.json();
}
async function approve(admin) {
  await click(admin, 'אישור הטופס');
  const dialog = admin.getByRole('dialog');
  const approved = admin.waitForResponse(
    (r) => r.url().endsWith('/approve') && r.request().method() === 'POST',
  );
  await dialog
    .getByRole('button', { name: 'אישור פעולה', exact: true })
    .click();
  assert.ok((await approved).ok(), 'Renewal approval rejected');
}
async function run() {
  if (process.argv[2] !== '--execute') {
    console.log(
      'PLAN ONLY: --execute tests annual/individual renewal, corrections and genuine Documents failure/retry with existing Phase 5 fixtures.',
    );
    return;
  }
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  await attest(config.env);
  const fixtures = JSON.parse(
    fs.readFileSync(path.join(dir, 'fixtures.json'), 'utf8'),
  );
  const newUser = JSON.parse(
    fs.readFileSync(path.join(dir, 'approved-trainee.json'), 'utf8'),
  );
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ac = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    }),
    admin = await ac.newPage();
  admin.setDefaultTimeout(35000);
  page = admin;
  await login(admin, fixtures.users[0], fixtures);
  const tc = await browser.newContext({
      viewport: { width: 390, height: 844 },
      acceptDownloads: true,
    }),
    trainee = await tc.newPage();
  trainee.setDefaultTimeout(45000);
  page = trainee;
  await login(trainee, fixtures.users[2], fixtures);
  const normal = api + '/event/get-all-events?branchId=' + fixtures.branches[0];
  step = 'already authenticated trainee before annual opening';
  const initialAccess = await tc.request.get(normal);
  const priorResults = fs.existsSync(path.join(dir, 'renewal-results.json'))
    ? JSON.parse(
        fs.readFileSync(path.join(dir, 'renewal-results.json'), 'utf8'),
      ).results
    : [];
  assert.ok(
    initialAccess.status() === 200 ||
      (initialAccess.status() === 403 &&
        priorResults.some(
          (r) => r.status === 'PASS' && r.name.startsWith('Annual opening'),
        )),
  );
  const before = await (await tc.request.get(api + '/auth/me')).json();
  assert.equal(before.mustChangePassword, false);
  const annualCompleted = priorResults.some(
    (r) => r.status === 'PASS' && r.name.startsWith('Annual approval'),
  );
  if (annualCompleted) {
    const existing = await (
      await tc.request.get(api + '/parent-registration/me')
    ).json();
    assert.ok(
      existing.previousApproved,
      'Prior approved annual version is missing',
    );
    for (const result of priorResults.filter(
      (r) =>
        r.status === 'PASS' &&
        /^(Annual |Newly approved|Existing trainee)/.test(r.name),
    ))
      results.push({ ...result, resumed: true });
    console.log(
      'Resuming after the already verified annual approval; no records reset.',
    );
  } else {
    page = admin;
    step = 'annual opening in real administrator UI';
    if (initialAccess.status() === 200) {
      await admin.goto(base + '/parent-registration');
      await click(admin, 'פתיחת רישום שנתי');
      const opened = admin.waitForResponse(
        (r) =>
          r.url() === api + '/parent-registration/admin/periods/open' &&
          r.request().method() === 'POST',
      );
      await admin
        .getByRole('dialog')
        .getByRole('button', { name: 'אישור פעולה', exact: true })
        .click();
      assert.ok((await opened).ok());
    }
    const denied = await tc.request.get(normal);
    assert.equal(denied.status(), 403);
    assert.equal((await denied.json()).code, 'PARENT_REGISTRATION_REQUIRED');
    assert.equal((await tc.request.get(api + '/auth/me')).status(), 200);
    pass(
      'Annual opening immediately blocks an already authenticated trainee at the backend while preserving essential access',
    );
    const nc = await browser.newContext({
        viewport: { width: 390, height: 844 },
      }),
      approvedPage = await nc.newPage();
    page = approvedPage;
    await login(approvedPage, newUser);
    assert.equal((await nc.request.get(normal)).status(), 200);
    pass(
      'Newly approved current-year trainee remains exempt from annual blocking',
    );
    page = trainee;
    step = 'annual one-parent submission';
    await trainee.goto(base + '/parent-registration');
    await fillForm(trainee, fixtures.users[2].nationalId, false);
    const yearly = await submit(trainee, '/parent-registration/me/submit');
    assert.equal(yearly.body.form.documentStatus, 'READY');
    pass(
      'Existing trainee completes actual annual renewal with one parent and real private evidence/PDF',
    );
    page = admin;
    step = 'annual approval and one-parent document review';
    const annualDetail = await openForm(admin, yearly.body.form.id);
    const version = annualDetail.versions[0],
      refs = Object.values(version.data.signatures);
    assert.equal(refs.length, 1);
    const download = admin.waitForEvent('download');
    await click(admin, 'הורדת PDF הרישום פרטי');
    await (await download).saveAs(path.join(dir, 'annual-one-parent.pdf'));
    await approve(admin);
    assert.equal((await tc.request.get(normal)).status(), 200);
    pass(
      'Annual approval preserves the logged-in session and removes backend restriction',
    );
  }
  const profileBefore = await (await tc.request.get(api + '/user/me')).json();
  async function requestRenew(blocking) {
    const current = await (
      await tc.request.get(api + '/parent-registration/me/status')
    ).json();
    if (
      current.form?.requestType === 'INDIVIDUAL' &&
      current.form.blocksAccess === blocking
    ) {
      const feedback = await (
        await tc.request.get(api + '/parent-registration/me/feedback')
      ).json();
      assert.equal(
        feedback.requestReason,
        'Phase5 fictional ' +
          (blocking ? 'blocking' : 'nonblocking') +
          ' renewal',
      );
      console.log('Resuming an existing fictional renewal; no records reset.');
      return current.form;
    }
    page = admin;
    await admin.goto(base + '/parent-registration');
    await click(admin, 'בקשת חידוש אישי');
    const dialog = admin.getByRole('dialog');
    await dialog.getByRole('combobox', { name: 'חניך/ה מהסניף' }).click();
    await admin
      .locator(`[role=option][data-value="${fixtures.users[2].id}"]`)
      .click();
    const checkbox = dialog.getByRole('checkbox', {
      name: 'בקשה חוסמת עד לאישור',
      exact: true,
    });
    if (blocking) await checkbox.check();
    else await checkbox.uncheck();
    await dialog
      .getByLabel(/^סיבה/)
      .fill(
        'Phase5 fictional ' +
          (blocking ? 'blocking' : 'nonblocking') +
          ' renewal',
      );
    const done = admin.waitForResponse(
      (r) => r.url().endsWith('/renew') && r.request().method() === 'POST',
    );
    await dialog
      .getByRole('button', { name: 'אישור פעולה', exact: true })
      .click();
    const r = await done;
    assert.ok(r.ok(), 'Renewal request failed');
    return r.json();
  }
  step = 'nonblocking individual request';
  const nonblock = await requestRenew(false);
  assert.equal((await tc.request.get(normal)).status(), 200);
  pass('Nonblocking individual renewal preserves backend access');
  const draft = await (
    await tc.request.get(api + '/parent-registration/me')
  ).json();
  assert.equal(draft.data.trainee.address, profileBefore.address);
  assert.equal(draft.data.signatures, undefined);
  pass(
    'Renewal prefills previous approved information and clears old signatures',
  );
  let detail;
  const resumingCorrection =
    nonblock.status === 'CHANGES_REQUESTED' &&
    priorResults.some(
      (r) => r.status === 'PASS' && r.name.startsWith('Real PDF recovery'),
    );
  if (resumingCorrection) {
    detail = await (
      await ac.request.get(
        api + `/parent-registration/admin/forms/${nonblock.id}`,
      )
    ).json();
    assert.equal(detail.form.status, 'CHANGES_REQUESTED');
    assert.equal(detail.versions.length, 1);
    for (const result of priorResults.filter(
      (r) => r.status === 'PASS' && r.name.startsWith('Real '),
    ))
      results.push({ ...result, resumed: true });
    console.log(
      'Resuming the actual correction request after verified Documents recovery.',
    );
  } else {
    page = trainee;
    await trainee.goto(base + '/parent-registration');
    await fillForm(trainee, fixtures.users[2].nationalId, false);
    step = 'genuine Documents failure preserves committed submission';
    stopDocuments();
    const failed = await submit(trainee, '/parent-registration/me/submit');
    assert.equal(failed.body.form.documentStatus, 'FAILED');
    assert.equal(failed.body.form.status, 'PENDING_REVIEW');
    pass(
      'Real Documents outage leaves an immutable submitted version and FAILED PDF state',
    );
    await restoreDocuments();
    page = admin;
    step = 'PDF retry and duplicate protection';
    await openForm(admin, nonblock.id);
    const retried = admin.waitForResponse(
      (r) => r.url().endsWith('/pdf/retry') && r.request().method() === 'POST',
    );
    await click(admin, 'ניסיון נוסף להפקת PDF');
    assert.ok((await retried).ok());
    const duplicate = await tc.request.post(
      api + '/parent-registration/me/submit',
      { headers: { Origin: base }, data: failed.payload },
    );
    assert.ok(duplicate.ok());
    assert.equal((await duplicate.json()).idempotent, true);
    const twice = await Promise.all([
      ac.request.post(
        api + `/parent-registration/admin/forms/${nonblock.id}/pdf/retry`,
        { headers: { Origin: base } },
      ),
      ac.request.post(
        api + `/parent-registration/admin/forms/${nonblock.id}/pdf/retry`,
        { headers: { Origin: base } },
      ),
    ]);
    assert.ok(twice.every((r) => r.ok()));
    detail = await (
      await ac.request.get(
        api + `/parent-registration/admin/forms/${nonblock.id}`,
      )
    ).json();
    assert.equal(detail.versions.length, 1);
    assert.equal(
      detail.documents.filter((d) => d.kind === 'REGISTRATION_PDF').length,
      1,
    );
    pass(
      'Real PDF recovery, repeated submission and concurrent retries produce one version and one PDF',
    );
    page = admin;
    step = 'administrator correction request';
    await admin.reload();
    await admin
      .getByRole('button', { name: 'פתיחת טופס', exact: true })
      .first()
      .click();
    await click(admin, 'בקשת תיקונים');
    const changes = admin.waitForResponse((r) =>
      r.url().endsWith('/request-changes'),
    );
    await admin
      .getByRole('dialog')
      .getByLabel(/^סיבה/)
      .fill('Phase5 fictional address correction');
    await admin
      .getByRole('dialog')
      .getByRole('button', { name: 'אישור פעולה', exact: true })
      .click();
    assert.ok((await changes).ok());
  }
  const correction = await (
    await tc.request.get(api + '/parent-registration/me')
  ).json();
  assert.equal(correction.data.signatures, undefined);
  assert.equal(
    (await (await tc.request.get(api + '/user/me')).json()).address,
    profileBefore.address,
  );
  page = trainee;
  await trainee.goto(base + '/parent-registration');
  await fillForm(trainee, fixtures.users[2].nationalId, false);
  step = 'content edits invalidate the completed signature';
  await trainee.getByRole('button', { name: /^1\./ }).click();
  const address = 'כתובת בדיקת Phase5 מתוקנת';
  const saved = trainee.waitForResponse(
    (r) =>
      r.url() === api + '/parent-registration/me/draft' &&
      r.request().postDataJSON()?.data?.trainee?.address === address,
  );
  await trainee.locator('[name="trainee.address"]').fill(address);
  assert.ok((await saved).ok());
  await trainee.getByRole('button', { name: /^5\./ }).click();
  await trainee.getByLabel('משטח חתימה הורה 1', { exact: true }).waitFor();
  await ink(trainee, 1);
  const revised = await submit(trainee, '/parent-registration/me/submit');
  assert.equal(revised.body.versionNumber, 2);
  assert.equal(revised.body.form.documentStatus, 'READY');
  page = admin;
  detail = await openForm(admin, nonblock.id);
  assert.equal(detail.versions.length, 2);
  assert.equal(
    detail.documents.filter((d) => d.kind === 'REGISTRATION_PDF').length,
    2,
  );
  assert.equal(
    (await (await tc.request.get(api + '/user/me')).json()).address,
    profileBefore.address,
  );
  await approve(admin);
  assert.equal(
    (await (await tc.request.get(api + '/user/me')).json()).address,
    address,
  );
  pass(
    'Corrections create a new immutable version; edits invalidate signatures; profile changes occur only after approval',
  );
  step = 'blocking individual request against the same authenticated session';
  const block = await requestRenew(true);
  const restricted = await tc.request.get(normal);
  assert.equal(restricted.status(), 403);
  assert.equal((await restricted.json()).code, 'PARENT_REGISTRATION_REQUIRED');
  pass(
    'Blocking individual renewal restricts an existing session at the backend',
  );
  page = trainee;
  await trainee.goto(base + '/parent-registration');
  await fillForm(trainee, fixtures.users[2].nationalId, false);
  const blockingSubmission = await submit(
    trainee,
    '/parent-registration/me/submit',
  );
  assert.equal(blockingSubmission.body.form.documentStatus, 'READY');
  page = admin;
  await openForm(admin, block.id);
  await approve(admin);
  assert.equal((await tc.request.get(normal)).status(), 200);
  pass(
    'Blocking individual renewal completes through real approval and restores access',
  );
  await trainee.setViewportSize({ width: 320, height: 844 });
  await trainee.screenshot({
    path: path.join(dir, 'renewal-mobile-320.png'),
    fullPage: true,
    mask: [trainee.locator('input[type=password]')],
  });
  fs.writeFileSync(
    path.join(dir, 'renewal-results.json'),
    JSON.stringify({ results, fullAcceptance: true }, null, 2),
  );
}
module.exports = { stopDocuments, restoreDocuments, submit, openForm, approve };
if (require.main === module)
  run()
    .catch(async (error) => {
      console.error(
        JSON.stringify({
          failedAt: step,
          errorType: error.name,
          errorCode: error.code,
          waiting: error.message
            ?.split('\n')
            .filter((l) => l.includes('waiting for'))
            .slice(0, 2),
        }),
      );
      results.push({ name: step, status: 'FAIL' });
      if (page) {
        await page
          .screenshot({
            path: path.join(dir, 'renewal-failure.png'),
            fullPage: true,
            mask: [page.locator('input[type=password]')],
          })
          .catch(() => {});
        fs.writeFileSync(
          path.join(dir, 'renewal-failure-ui.txt'),
          await page
            .locator('body')
            .innerText()
            .catch(() => ''),
          { mode: 0o600 },
        );
      }
      fs.writeFileSync(
        path.join(dir, 'renewal-results.json'),
        JSON.stringify({ results, fullAcceptance: false }, null, 2),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await restoreDocuments();
      await browser?.close();
    });
