// Actual local application + Supabase DEV + local Documents. No route mocks,
// fabricated evidence states, JWT injection, CAPTCHA overrides or trace secrets.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  { randomInt } = require('node:crypto');
const { attest, file, dir } = require('./phase5-local.cjs');
const { chromium } = require(
  path.resolve(
    __dirname,
    '../../EtLaasot-Client/node_modules/@playwright/test',
  ),
);
const base = 'http://127.0.0.1:5185',
  api = 'http://127.0.0.1:3185';
const fixtureFile = path.join(dir, 'fixtures.json'),
  resultsFile = path.join(dir, 'browser-results.json');
let step = 'initialization',
  activePage,
  browser;
const results = [];
const pass = (name) => {
  results.push({ name, status: 'PASS' });
  console.log('PASS: ' + name);
};
function id() {
  const b = String(randomInt(81000000, 89999999));
  const n = [...b].reduce((s, c, i) => {
    const x = Number(c) * ((i % 2) + 1);
    return s + (x > 9 ? x - 9 : x);
  }, 0);
  return b + ((10 - (n % 10)) % 10);
}
async function click(page, name) {
  await page.getByRole('button', { name, exact: true }).click();
}
async function select(page, name, option) {
  await page.getByRole('combobox', { name: new RegExp('^' + name) }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
async function login(page, user, fixtures) {
  let changedPassword = false;
  activePage = page;
  step = 'password login';
  await page.goto(base + '/login');
  await page.getByLabel('תעודת זהות', { exact: true }).fill(user.nationalId);
  await click(page, 'המשך');
  await page
    .getByLabel('סיסמה', { exact: true })
    .fill(user.currentPassword ?? user.password);
  await click(page, 'התחבר');
  if (!user.currentPassword) {
    step = 'mandatory password change';
    await page.waitForURL('**/change-password');
    await page.getByLabel('סיסמה נוכחית', { exact: true }).fill(user.password);
    await page.getByLabel('סיסמה חדשה', { exact: true }).fill(user.newPassword);
    await page
      .getByLabel('אימות סיסמה חדשה', { exact: true })
      .fill(user.newPassword);
    const changed = page.waitForResponse(
      (r) =>
        r.url() === api + '/auth/change-password' &&
        r.request().method() === 'PATCH',
    );
    await click(page, 'עדכון סיסמה');
    assert.ok((await changed).ok(), 'Password change rejected');
    changedPassword = true;
    user.currentPassword = user.newPassword;
    if (fixtures)
      fs.writeFileSync(fixtureFile, JSON.stringify(fixtures), { mode: 0o600 });
  }
  await page.waitForURL(
    (u) =>
      !u.pathname.includes('login') && !u.pathname.includes('change-password'),
  );
  pass(
    changedPassword
      ? 'Real browser temporary-password login and mandatory password change'
      : 'Real browser password authentication',
  );
}
async function ink(page, parent) {
  const canvas = page.getByLabel(`משטח חתימה הורה ${parent}`, { exact: true });
  await canvas.scrollIntoViewIfNeeded();
  const b = await canvas.boundingBox();
  assert.ok(b);
  await page.mouse.move(b.x + 15, b.y + 50);
  await page.mouse.down();
  for (let n = 1; n < 12; n++)
    await page.mouse.move(
      b.x + 15 + n * 8,
      b.y + 50 + Math.sin(n) * 15 + parent * 2,
    );
  await page.mouse.up();
  const section = canvas.locator('..');
  await section
    .getByRole('button', { name: 'סיום חתימה', exact: true })
    .click();
}
async function fillForm(page, nationalId, twoParents = true) {
  step = 'fill five-stage form';
  await click(page, 'קראתי, המשך למילוי הטופס');
  await page.getByRole('button', { name: /^1\./ }).click();
  const field = async (name, value) => {
    await page.locator(`[name="${name}"]`).fill(String(value));
  };
  for (const [name, value] of Object.entries({
    'trainee.name': 'חניך',
    'trainee.familyName': 'בדיקת Phase5',
    'trainee.nationalId': nationalId,
    'trainee.dateOfBirth': '2010-01-01',
    'trainee.phone': '0500000000',
    'trainee.email': 'fictional-phase5@example.invalid',
    'trainee.address': 'כתובת בדיונית לבדיקת Phase5',
    'trainee.healthFund': 'קופת בדיקה',
    'trainee.pantsSize': 'M',
    'trainee.siblings': 2,
  }))
    await field(name, value);
  await select(page, 'מין', 'זכר');
  await select(page, 'מידת חולצה', 'M');
  await page.getByRole('button', { name: /^2\./ }).click();
  for (const [name, value] of Object.entries({
    'parent1.name': 'הורה ראשון בדיקה',
    'parent1.phone': '0500000001',
    'contacts.familyStatus': 'משפחת בדיקה',
    'contacts.emergencyName': 'איש קשר בדיקה',
    'contacts.emergencyRelationship': 'משפחה',
    'contacts.emergencyPhone': '0500000002',
    'trainee.school': 'בית ספר בדיקה',
    ...(twoParents
      ? { 'parent2.name': 'הורה שני בדיקה', 'parent2.phone': '0500000003' }
      : {}),
  }))
    await field(name, value);
  await page.getByRole('button', { name: /^3\./ }).click();
  for (const group of [
    'האם יש מגבלה בריאותית, מחלה פעילה או אבחנות?',
    'האם קיימת מגבלה על השתתפות מלאה או חלקית בפעילות?',
    'האם נוטלים תרופות?',
    'האם קיימת רגישות למזון?',
    'האם יש קשיים בשירותים?',
    'האם משתמש/ת בטיטולים?',
  ])
    await page
      .getByRole('radiogroup', { name: group, exact: true })
      .getByRole('radio', { name: 'לא', exact: true })
      .check();
  await page
    .getByRole('radiogroup', { name: 'האם אוכל/ת באופן עצמאי?', exact: true })
    .getByRole('radio', { name: 'כן', exact: true })
    .check();
  await select(page, 'מצב התפתחותי', 'מתאים לגיל הכרונולוגי');
  for (const [name, value] of Object.entries({
    'medical.physicianName': 'רופא בדיקה',
    'medical.physicianHealthFund': 'קופת בדיקה',
    'medical.physicianPhone': '0500000004',
  }))
    await field(name, value);
  await page.getByRole('button', { name: /^4\./ }).click();
  for (const box of await page.getByRole('checkbox').all()) await box.check();
  await page.getByRole('button', { name: /^5\./ }).click();
  await field('parent1.nationalId', '123456782');
  if (twoParents) await field('parent2.nationalId', '000000018');
  const image = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 600;
    c.height = 150;
    const x = c.getContext('2d');
    x.fillStyle = 'white';
    x.fillRect(0, 0, 600, 150);
    x.fillStyle = 'black';
    x.font = '18px sans-serif';
    x.fillText(
      'PHASE5 FICTIONAL MEDICAL SUMMARY - NO REAL HEALTH DATA',
      10,
      60,
    );
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('בחירת סיכום רפואי', { exact: true }).setInputFiles({
    name: 'phase5-fictional-summary.png',
    mimeType: 'image/png',
    buffer: Buffer.from(image, 'base64'),
  });
  await ink(page, 1);
  if (twoParents) await ink(page, 2);
}
async function run() {
  if (process.argv[2] !== '--execute') {
    console.log(
      'PLAN ONLY: --execute exercises the actual local services using the separately created fictional fixtures. No cloud infrastructure changes.',
    );
    return;
  }
  const config = JSON.parse(fs.readFileSync(file, 'utf8'));
  await attest(config.env);
  const fixtures = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const adminContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
    }),
    admin = await adminContext.newPage();
  admin.setDefaultTimeout(30000);
  await login(admin, fixtures.users[0], fixtures);
  const traineeContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      acceptDownloads: true,
    }),
    applicant = await traineeContext.newPage();
  applicant.setDefaultTimeout(45000);
  activePage = applicant;
  const nationalId = id();
  step = 'new applicant ID-first entry';
  await applicant.goto(base + '/login');
  await applicant.getByLabel('תעודת זהות', { exact: true }).fill(nationalId);
  await click(applicant, 'המשך');
  await click(applicant, 'להתחלת רישום חניך');
  await applicant.getByRole('combobox', { name: 'סניף פעיל' }).click();
  await applicant
    .getByRole('option', { name: new RegExp(config.branches[0]) })
    .click();
  const started = applicant.waitForResponse(
    (r) =>
      r.url() === api + '/parent-applications/start' &&
      r.request().method() === 'POST',
  );
  await click(applicant, 'יצירת בקשה ללא חשבון');
  const created = await started;
  assert.ok(created.ok(), 'Applicant creation failed');
  const state = await created.json();
  fs.writeFileSync(
    path.join(dir, 'applicant-session.json'),
    JSON.stringify({ nationalId, ...state }),
    { mode: 0o600 },
  );
  await click(applicant, 'שמרתי את קוד השחזור במקום בטוח');
  await fillForm(applicant, nationalId, true);
  step = 'private medical upload, two signatures, submission and real PDF';
  const submitted = applicant.waitForResponse(
    (r) =>
      r.url() === api + '/parent-applications/me/submit' &&
      r.request().method() === 'POST',
    { timeout: 120000 },
  );
  await click(applicant, 'שליחת הטופס');
  const response = await submitted;
  assert.ok(response.ok(), 'Submission rejected');
  const body = await response.json();
  assert.equal(
    body.application.documentStatus,
    'READY',
    'Real PDF did not become ready',
  );
  pass(
    'New applicant → real private PNG medical upload → two signatures → submission → local Documents PDF',
  );
  step = 'authorized branch administrator document review';
  activePage = admin;
  await admin.goto(base + '/parent-applications-admin');
  await admin
    .getByRole('button', { name: new RegExp(state.application.id.slice(0, 8)) })
    .click();
  const download = admin.waitForEvent('download');
  await admin
    .getByRole('button', { name: 'הורדת PDF הרישום פרטי', exact: true })
    .click();
  const pdf = await download;
  await pdf.saveAs(path.join(dir, 'new-trainee-two-parents.pdf'));
  const bytes = fs.readFileSync(path.join(dir, 'new-trainee-two-parents.pdf'));
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  const { getDocument } = await import(
    require('node:url').pathToFileURL(
      path.resolve(
        __dirname,
        '../../EtLaasot-Documents/node_modules/pdfjs-dist/legacy/build/pdf.mjs',
      ),
    ).href
  );
  const document = await getDocument({ data: new Uint8Array(bytes) }).promise;
  let text = '';
  for (let i = 1; i <= document.numPages; i++) {
    const p = await document.getPage(i);
    text += (await p.getTextContent()).items.map((x) => x.str ?? '').join(' ');
  }
  assert.ok(text.includes('בדיקה'));
  assert.ok(text.includes('מצהירים'));
  await document.destroy();
  pass(
    'Authorized branch administrator downloads a valid Hebrew PDF from private evidence',
  );
  step = 'cross-branch denial';
  const otherContext = await browser.newContext(),
    other = await otherContext.newPage();
  await login(other, fixtures.users[1], fixtures);
  const reviewed = await (
    await adminContext.request.get(
      api + `/parent-applications/admin/${state.application.id}`,
    )
  ).json();
  const pdfId = reviewed.documents.find(
    (d) => d.kind === 'REGISTRATION_PDF' && d.versionId === body.versionId,
  ).id;
  const denied = await otherContext.request.get(
    api +
      `/parent-applications/admin/${state.application.id}/documents/${pdfId}`,
  );
  assert.equal(denied.status(), 403);
  pass('Other branch administrator denied at backend');
  step = 'approval provisions existing temporary-password flow';
  activePage = admin;
  await admin
    .getByRole('checkbox', {
      name: 'אימתתי ידנית את זהות החניך וההורה ואת שיוכם לסניף',
    })
    .check();
  const approval = admin.waitForResponse(
    (r) =>
      r.url() ===
      api + `/parent-applications/admin/${state.application.id}/approve`,
  );
  await click(admin, 'אישור ויצירת חשבון חניך');
  const approved = await approval;
  assert.ok(approved.ok(), 'Approval failed');
  const approvedBody = await approved.json();
  const temporaryPassword = await admin
    .getByLabel('סיסמה זמנית למסירה', { exact: true })
    .inputValue();
  assert.equal(temporaryPassword, approvedBody.temporaryPassword);
  const userContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
    }),
    userPage = await userContext.newPage();
  const newUser = {
    nationalId,
    password: temporaryPassword,
    newPassword:
      require('../dist/modules/auth/password.util').generateTemporaryPassword(),
  };
  await login(userPage, newUser);
  pass(
    'Approved trainee authenticates with real generated temporary password and completes mandatory password change',
  );
  fs.writeFileSync(
    path.join(dir, 'approved-trainee.json'),
    JSON.stringify({ id: approvedBody.userId, ...newUser }),
    { mode: 0o600 },
  );
  await applicant.screenshot({
    path: path.join(dir, 'submitted-mobile.png'),
    fullPage: true,
    mask: [applicant.locator('input[type=password]')],
  });
  fs.writeFileSync(
    resultsFile,
    JSON.stringify(
      {
        results,
        applicationId: state.application.id,
        versionId: body.versionId,
        fullAcceptance: false,
        remaining: [
          'annual and individual renewals',
          'corrections',
          'one-parent submission',
          'PDF failures and retries',
        ],
      },
      null,
      2,
    ),
  );
}
module.exports = { login, fillForm, click, select, ink };
if (require.main === module)
  run()
    .catch(async (error) => {
      console.error(
        JSON.stringify({ errorType: error.name, errorCode: error.code }),
      );
      results.push({ name: step, status: 'FAIL' });
      console.error(
        'FAIL at step: ' +
          step +
          ' (credential-bearing error details suppressed)',
      );
      if (activePage) {
        await activePage
          .screenshot({
            path: path.join(dir, 'failure.png'),
            fullPage: true,
            mask: [activePage.locator('input[type=password]')],
          })
          .catch(() => {});
        fs.writeFileSync(
          path.join(dir, 'failure-ui.txt'),
          await activePage
            .locator('body')
            .innerText()
            .catch(() => ''),
          { mode: 0o600 },
        );
      }
      fs.writeFileSync(
        resultsFile,
        JSON.stringify({ results, fullAcceptance: false }, null, 2),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      await browser?.close();
    });
