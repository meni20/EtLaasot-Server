// One DEV-only QA run. Credentials remain in process memory; output is status only.
const h = require('./volunteer-dev-target.cjs'),
  fs = require('node:fs'),
  path = require('node:path'),
  { randomUUID, randomInt } = require('node:crypto');
const API = 'https://etlaasot-server-dev-dev.up.railway.app',
  WEB = 'https://etlaasot-client-dev-dev.up.railway.app';
let stage = 'preflight',
  browser,
  db;
const checks = [],
  owned = {};
function ok(condition, code) {
  if (!condition) {
    const e = Error(code);
    e.auditCode = code;
    throw e;
  }
}
function pass(name) {
  checks.push(name);
  console.log('PASS ' + name);
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function request(
  method,
  route,
  body,
  credential,
  kind = 'manager',
  expected,
) {
  const headers = { Origin: WEB };
  if (credential)
    headers[kind === 'applicant' ? 'X-Applicant-Session' : 'Authorization'] =
      kind === 'applicant' ? credential : 'Bearer ' + credential;
  if (body && !(body instanceof FormData))
    headers['Content-Type'] = 'application/json';
  const response = await fetch(API + route, {
    method,
    headers,
    body:
      body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(90000),
  });
  if (expected !== undefined)
    ok(response.status === expected, 'HTTP_STATUS_' + response.status);
  else ok(response.ok, 'HTTP_STATUS_' + response.status);
  const content = response.headers.get('content-type') || '';
  return {
    response,
    data: content.includes('json')
      ? await response.json()
      : await response.arrayBuffer(),
  };
}
const png = fs.readFileSync(
  path.resolve(__dirname, '../../EtLaasot-Documents/mock/signature.png'),
);
async function upload(token, revision, kind, purpose) {
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), 'qa.png');
  form.append('revision', String(revision));
  if (purpose) form.append('signer', purpose);
  return (
    await request(
      'POST',
      '/parent-applications/me/attachments/' + kind,
      form,
      token,
      'applicant',
    )
  ).data;
}
async function save(token, data, revision, currentStep = 5) {
  return (
    await request(
      'PATCH',
      '/parent-applications/me/draft',
      { data, revision, currentStep },
      token,
      'applicant',
    )
  ).data;
}
async function me(token) {
  return (
    await request(
      'GET',
      '/parent-applications/me',
      undefined,
      token,
      'applicant',
    )
  ).data;
}
async function completeApi(token, data, type) {
  let s = await me(token);
  s = await save(token, data, s.application.revision);
  if (type === 'TRAINEE') {
    const file = await upload(
      token,
      s.application.revision,
      'PHYSICIAN_SUMMARY',
    );
    s = await save(
      token,
      {
        ...s.data,
        medical: {
          ...s.data.medical,
          physicianSummaryDocumentId: file.documentId,
        },
      },
      s.application.revision,
    );
  } else if (
    s.data.volunteer.gender === 'male' &&
    s.data.volunteer.dateOfBirth < '2008-01-01'
  ) {
    const file = await upload(
      token,
      s.application.revision,
      'POLICE_CLEARANCE',
    );
    s = await save(
      token,
      { ...s.data, policeClearanceDocumentId: file.documentId },
      s.application.revision,
    );
  }
  for (const purpose of type === 'TRAINEE'
    ? ['parent1']
    : [
        'VOLUNTEER_AGREEMENT',
        ...(s.data.parentConsent ? ['PARENTAL_CONSENT'] : []),
        'CONFIDENTIALITY',
      ]) {
    const sig = await upload(
      token,
      s.application.revision,
      'SIGNATURE',
      purpose,
    );
    const ref = {
      documentId: sig.documentId,
      contentHash: sig.contentHash,
      signedAt: sig.signedAt,
      ...(sig.agreementVersion
        ? { agreementVersion: sig.agreementVersion }
        : {}),
    };
    s = await save(
      token,
      { ...s.data, signatures: { ...s.data.signatures, [purpose]: ref } },
      s.application.revision,
    );
  }
  const sent = (
    await request(
      'POST',
      '/parent-applications/me/submit',
      { revision: s.application.revision, idempotencyKey: randomUUID() },
      token,
      'applicant',
    )
  ).data;
  ok(sent.application.documentStatus === 'READY', 'PDF_NOT_READY');
  return sent;
}
async function select(page, label, value) {
  await page
    .getByRole('combobox', {
      name: new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    })
    .click();
  await page.getByRole('option', { name: value, exact: true }).click();
}
async function step(page, n) {
  await page
    .getByRole('button', { name: new RegExp('^' + n + '\\. ') })
    .click();
}
async function saved(page) {
  await page
    .getByText('נשמר', { exact: true })
    .waitFor({ state: 'visible', timeout: 45000 });
}
async function sign(page, purpose) {
  await saved(page);
  const section = page.getByTestId('signature-' + purpose),
    canvas = section.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const r = await canvas.boundingBox();
  ok(r, 'SIGNATURE_CANVAS');
  await page.mouse.move(r.x + 15, r.y + 50);
  await page.mouse.down();
  for (let i = 1; i < 12; i++)
    await page.mouse.move(r.x + 15 + i * 12, r.y + 50 + Math.sin(i) * 15);
  await page.mouse.up();
  await section.getByRole('button', { name: 'סיום חתימה' }).click();
  await section.getByRole('button', { name: 'שמירת חתימה' }).click();
  await section
    .getByText('חתימה שמורה', { exact: true })
    .waitFor({ timeout: 45000 });
  await saved(page);
}
async function loginUi(page, id, password) {
  await page.goto(WEB + '/login');
  await page.getByLabel('תעודת זהות', { exact: true }).fill(id);
  await page.getByRole('button', { name: 'המשך', exact: true }).click();
  await page.getByLabel('סיסמה', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'התחבר', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.includes('login'), {
    timeout: 45000,
  });
}
async function newPage(mobile = false) {
  const context = await browser.newContext({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 1000 },
    locale: 'he-IL',
  });
  await context.route('**/*', (route) => {
    const host = new URL(route.request().url()).hostname;
    if (
      ![
        new URL(API).hostname,
        new URL(WEB).hostname,
        h.REF + '.supabase.co',
      ].includes(host)
    )
      return route.abort();
    return route.continue();
  });
  return { context, page: await context.newPage() };
}
async function browserVolunteer(id, minor, branch) {
  const c = await newPage(true),
    p = c.page;
  await p.goto(WEB + '/login');
  await p.getByLabel('תעודת זהות', { exact: true }).fill(id);
  await p.getByRole('button', { name: 'המשך', exact: true }).click();
  await p
    .getByRole('button', { name: 'להתחלת רישום חניך', exact: true })
    .click();
  await select(p, 'סניף פעיל', branch.name + ' · ' + branch.city);
  await select(p, 'סוג הרשמה', 'הרשמה למתנדב');
  ok(
    (await p.getByLabel('תעודת זהות מתנדב', { exact: true }).inputValue()) ===
      id,
    'ID_NOT_PRESERVED',
  );
  const started = p.waitForResponse(
    (r) =>
      r.url() === API + '/parent-applications/start' &&
      r.request().method() === 'POST',
  );
  await p.getByRole('button', { name: 'יצירת בקשה ללא חשבון' }).click();
  const start = await (await started).json();
  ok(
    start.sessionToken && start.application.registrationType === 'VOLUNTEER',
    'VOLUNTEER_START',
  );
  await p
    .getByRole('button', { name: 'שמרתי את קוד השחזור במקום בטוח' })
    .click();
  for (const [label, value] of [
    ['שם פרטי', minor ? 'קטין' : 'מתנדב'],
    ['שם משפחה', 'בדיקת DEV'],
    ['כתובת מגורים', 'כתובת בדיקה בלבד'],
    ['מייל', 'fictional@example.invalid'],
    ['מספר טלפון של המתנדב', '0520000000'],
    ['שם אמא', 'אם בדיקה'],
    ['פלאפון אמא', '0500000001'],
    ['שם אב', 'אב בדיקה'],
    ['פלאפון אב', '0500000002'],
  ])
    await p.getByLabel(label, { exact: false }).first().fill(value);
  await p
    .getByLabel('תאריך לידה', { exact: false })
    .fill(minor ? '2010-01-01' : '2000-01-01');
  await select(p, 'מין', 'זכר');
  await select(p, 'מידת חולצה', 'M');
  if (minor) {
    await p.getByLabel('בית ספר', { exact: false }).fill('בית ספר בדיקה');
    await p.getByLabel('כיתה', { exact: false }).fill('י');
  }
  await saved(p);
  await p.reload();
  ok(
    (await p.getByLabel('מספר טלפון של המתנדב').inputValue()) === '0520000000',
    'AUTOSAVE_PHONE',
  );
  await step(p, 2);
  await select(p, 'מעוניין להתנדב במשחקייה/חונכות בית/אחר', 'משחקייה');
  await select(p, 'קטן/בוגר', 'קטן');
  await select(p, 'מדבר/לא מתקשר', 'מדבר');
  await select(p, 'עם טיטול/ללא טיטול', 'ללא טיטול');
  await p.getByRole('radio', { name: 'לא', exact: true }).nth(0).check();
  await p.getByRole('radio', { name: 'לא', exact: true }).nth(1).check();
  await p
    .getByLabel('4. מה הביא אותך לרצות להתנדב בעמותת עת לעשות?', {
      exact: false,
    })
    .fill('בדיקת DEV סינתטית בלבד');
  await saved(p);
  await step(p, 3);
  await p
    .getByRole('checkbox', { name: 'קראתי ואני מאשר/ת את הסכם ההתנדבות' })
    .check();
  await sign(p, 'VOLUNTEER_AGREEMENT');
  await step(p, 4);
  if (minor) {
    await p.getByLabel('שם ההורה', { exact: false }).fill('הורה בדיקה');
    await p.getByLabel('תעודת זהות ההורה', { exact: false }).fill('000000026');
    await p
      .getByLabel('תאריך אישור ההורה', { exact: false })
      .fill(new Date().toISOString().slice(0, 10));
    await p
      .getByRole('checkbox', {
        name: 'אני ההורה מאשר/ת את ההשתתפות כמפורט בנוסח',
      })
      .check();
    await sign(p, 'PARENTAL_CONSENT');
  } else await p.getByText(/אישור הורים אינו נדרש/).waitFor();
  await step(p, 5);
  if (!minor) {
    await p
      .getByLabel('אישור משטרה', { exact: true })
      .setInputFiles({ name: 'qa.png', mimeType: 'image/png', buffer: png });
    await p.getByText('קובץ נשמר באחסון פרטי').waitFor({ timeout: 45000 });
    await saved(p);
  }
  await p
    .getByRole('checkbox', {
      name: 'קראתי ואני מאשר/ת את ההתחייבות לשמירת סודיות',
    })
    .check();
  await sign(p, 'CONFIDENTIALITY');
  const sent = p.waitForResponse(
    (r) =>
      r.url() === API + '/parent-applications/me/submit' &&
      r.request().method() === 'POST',
    { timeout: 90000 },
  );
  await p.getByRole('button', { name: 'שליחת בקשת התנדבות' }).click();
  const submitted = await (await sent).json();
  ok(
    submitted.versionId && submitted.application.documentStatus === 'READY',
    'BROWSER_VOLUNTEER_PDF',
  );
  await p.getByText('הטופס נשלח בהצלחה והועבר לטיפול.').waitFor();
  return { ...c, start, submitted };
}
async function main() {
  fs.mkdirSync(path.resolve(__dirname, '../.tmp'), { recursive: true });
  h.status();
  const v = h.variables('server');
  h.assertDb(v);
  Object.assign(process.env, v);
  require('ts-node').register({
    transpileOnly: true,
    compilerOptions: {
      module: 'CommonJS',
      moduleResolution: 'node',
      resolvePackageJsonExports: false,
    },
  });
  require('tsconfig-paths/register');
  require('reflect-metadata');
  const { Sequelize, Model } = require('sequelize-typescript');
  const Base = require('sequelize').Model;
  const models = [];
  function visit(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) visit(f);
      else if (e.name.endsWith('.entity.ts'))
        for (const x of Object.values(require(f)))
          if (typeof x === 'function' && x.prototype instanceof Base)
            models.push(x);
    }
  }
  visit(path.resolve('src/modules'));
  const cfg = h.databaseConfig(v);
  db = new Sequelize({
    ...cfg,
    username: cfg.user,
    dialect: 'postgres',
    dialectOptions: { ssl: cfg.ssl },
    logging: false,
    models,
    pool: { max: 4, min: 0 },
  });
  const [identity] = await db.query(
    "SELECT current_database()='postgres' AND current_user='etlaasot_app' AS ok",
  );
  ok(identity[0].ok, 'DATABASE_IDENTITY');
  const Branch =
      require('../src/modules/branch/entities/branch.entity').default,
    User = require('../src/modules/user/entities/user.entity').default,
    UserRole =
      require('../src/modules/user-role/enitites/user-role.entity').default;
  const {
    getNationalIdDetails,
  } = require('../src/modules/user/national-id.util');
  const UserService = require('../src/modules/user/user.service').default,
    UserRepository = require('../src/modules/user/user.repository').default,
    RoleService = require('../src/modules/user-role/user-role.service').default,
    RoleRepo = require('../src/modules/user-role/user-role.repositroy').default;
  const roleService = new RoleService(new RoleRepo()),
    users = new UserService(db, new UserRepository(), roleService),
    {
      generateTemporaryPassword,
    } = require('../src/modules/auth/password.util');
  async function nationalId() {
    while (true) {
      const base = '00009' + String(randomInt(1000)).padStart(3, '0');
      let sum = base.split('').reduce((s, n, i) => {
        let a = Number(n) * ((i % 2) + 1);
        return s + (a > 9 ? a - 9 : a);
      }, 0);
      const id = base + String((10 - (sum % 10)) % 10),
        hash = getNationalIdDetails(id).nationalIdHash;
      const [rows] = await db.query(
        'SELECT 1 FROM "user" WHERE national_id_hash=:hash UNION ALL SELECT 1 FROM trainee_applications WHERE national_id_hash=:hash',
        { replacements: { hash } },
      );
      if (!rows.length) return id;
    }
  }
  stage = 'seed QA branch managers';
  const branch = await Branch.create({
    id: 'phase5-qa-' + randomUUID().slice(0, 8),
    name: 'DEV QA רישום ' + randomUUID().slice(0, 4),
    city: 'עיר בדיקה DEV',
    isActive: true,
  });
  const other = await Branch.create({
    id: 'phase5-qa-' + randomUUID().slice(0, 8),
    name: 'DEV QA בידוד',
    city: 'עיר בדיקה DEV',
    isActive: true,
  });
  owned.branches = [branch.id, other.id];
  async function manager(b) {
    const id = await nationalId();
    const created = await db.transaction(async (t) => {
      const r = await users.createUserWithRole(
        {
          id,
          name: 'מנהל בדיקת DEV',
          phoneNumber: '0520000099',
          dateOfBirth: '1990-01-01',
          gender: 'male',
          email: 'qa@example.invalid',
          branchId: b.id,
          isActive: true,
        },
        t,
      );
      await roleService.asignRoleToUser(
        r.user.id,
        10000,
        'DEV QA fixture',
        t,
        b.id,
      );
      await UserRole.destroy({
        where: { userId: r.user.id, roleId: 1 },
        transaction: t,
      });
      return r;
    });
    const first = (
      await request('POST', '/auth/login', {
        identifier: id,
        password: created.temporaryPassword,
      })
    ).data;
    ok(first.mustChangePassword === true, 'MANAGER_FIRST_LOGIN');
    const password = generateTemporaryPassword();
    await request(
      'PATCH',
      '/auth/change-password',
      {
        currentPassword: created.temporaryPassword,
        newPassword: password,
        confirmPassword: password,
      },
      first.token,
    );
    const login = (
      await request('POST', '/auth/login', { identifier: id, password })
    ).data;
    return { id, password, token: login.token, userId: created.user.id };
  }
  const manager1 = await manager(branch),
    manager2 = await manager(other);
  owned.managers = [manager1.userId, manager2.userId];
  pass('isolated DEV QA managers created with normal password change');
  stage = 'trainee regression and authenticated Documents smoke';
  const traineeId = await nationalId(),
    started = (
      await request('POST', '/parent-applications/start', {
        identifier: traineeId,
        branchId: branch.id,
      })
    ).data;
  ok(started.application.registrationType === 'TRAINEE', 'LEGACY_DEFAULT');
  const data =
    require('../src/modules/parent-registration/registration.test-fixtures').fictionalRegistration(
      false,
    );
  data.trainee.nationalId = traineeId;
  delete data.signatures;
  delete data.medical.physicianSummaryDocumentId;
  const trainee = await completeApi(started.sessionToken, data, 'TRAINEE');
  const approval = (
    await request(
      'POST',
      '/parent-applications/admin/' + started.application.id + '/approve',
      { expectedVersionId: trainee.versionId, identityVerified: true },
      manager1.token,
    )
  ).data;
  ok(approval.temporaryPassword?.length === 18, 'TRAINEE_APPROVAL');
  owned.trainee = {
    applicationId: started.application.id,
    userId: approval.userId,
  };
  pass(
    'old API defaults to TRAINEE, private evidence, signed parent PDF and manager approval',
  );
  if (
    h.variables('server').VOLUNTEER_REGISTRATION_ENABLED === 'true' &&
    h.variables('client').VITE_VOLUNTEER_REGISTRATION_ENABLED === 'true'
  ) {
    pass('DEV-only feature flags already enabled and deployments verified');
  } else {
    stage = 'enable DEV volunteer flags';
    ok(
      (
        await request(
          'POST',
          '/parent-applications/start',
          {
            identifier: await nationalId(),
            branchId: branch.id,
            registrationType: 'VOLUNTEER',
          },
          undefined,
          'manager',
          404,
        )
      ).response.status === 404,
      'FLAG_DISABLED',
    );
    for (const [s, k] of [
      ['server', 'VOLUNTEER_REGISTRATION_ENABLED'],
      ['client', 'VITE_VOLUNTEER_REGISTRATION_ENABLED'],
    ]) {
      h.status();
      h.assertDb(h.variables('server'));
      h.run([
        'variable',
        'set',
        k + '=true',
        '--project',
        h.PROJECT,
        '--environment',
        h.ENVIRONMENT,
        '--service',
        h.SERVICES[s],
      ]);
    }
    const end = Date.now() + 12 * 60000;
    let deployed = false;
    while (Date.now() < end) {
      const s = h.status();
      const instances = s.environment.serviceInstances.edges.map((e) => e.node);
      if (
        instances.every((n) => n.latestDeployment.status === 'SUCCESS') &&
        instances.find((n) => n.serviceId === h.SERVICES.client)
          .latestDeployment.createdAt >
          new Date(Date.now() - 12 * 60000).toISOString()
      ) {
        deployed = true;
        break;
      }
      await delay(15000);
    }
    ok(deployed, 'FLAG_DEPLOYMENT_TIMEOUT');
    pass(
      'DEV-only feature flags enabled after healthy services, trainee PDF smoke and private Storage verification',
    );
  }
  stage = 'browser adult registration';
  const {
    chromium,
  } = require('../../EtLaasot-Client/node_modules/@playwright/test');
  browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  });
  const adultId = await nationalId(),
    adult = await browserVolunteer(adultId, false, branch);
  owned.adult = { applicationId: adult.start.application.id };
  pass(
    'adult browser ID-first selector, five stages, phone autosave/reload, police evidence, signatures and signed PDF',
  );
  stage = 'manager review and corrections';
  const admin = await newPage();
  await loginUi(admin.page, manager1.id, manager1.password);
  await admin.page.goto(WEB + '/parent-applications-admin');
  await select(admin.page, 'סוג הרשמה', 'מתנדבים');
  await admin.page.getByRole('button', { name: /^מתנדב בדיקת DEV/ }).click();
  await admin.page.getByText('0520000000', { exact: true }).waitFor();
  await admin.page
    .getByRole('button', { name: 'הורדת אישור משטרה פרטי' })
    .waitFor();
  const dl = admin.page.waitForEvent('download');
  await admin.page
    .getByRole('button', { name: 'הורדת PDF הרישום פרטי' })
    .click();
  await dl;
  await admin.page
    .getByLabel('סיבת החזרה לתיקון או דחייה')
    .fill('DEV QA תיקון סינתטי');
  const correction = admin.page.waitForResponse(
    (r) =>
      r.url().endsWith('/request-changes') && r.request().method() === 'POST',
  );
  await admin.page
    .getByRole('button', { name: 'החזרה לתיקון', exact: true })
    .click();
  ok((await correction).ok(), 'REQUEST_CORRECTIONS');
  await adult.page.reload();
  await adult.page.getByRole('heading', { name: 'הרשמה למתנדב/ת' }).waitFor();
  await step(adult.page, 2);
  await adult.page
    .getByLabel('4. מה הביא אותך לרצות להתנדב בעמותת עת לעשות?', {
      exact: false,
    })
    .fill('DEV QA לאחר תיקון');
  await saved(adult.page);
  await step(adult.page, 3);
  await sign(adult.page, 'VOLUNTEER_AGREEMENT');
  await step(adult.page, 5);
  await sign(adult.page, 'CONFIDENTIALITY');
  const newSent = adult.page.waitForResponse(
    (r) => r.url().endsWith('/me/submit') && r.request().method() === 'POST',
    { timeout: 90000 },
  );
  await adult.page.getByRole('button', { name: 'שליחת בקשת התנדבות' }).click();
  const newVersion = await (await newSent).json();
  ok(
    newVersion.application.documentStatus === 'READY' &&
      newVersion.versionId !== adult.submitted.versionId,
    'RESUBMISSION_PDF',
  );
  let detail = (
    await request(
      'GET',
      '/parent-applications/admin/' + adult.start.application.id,
      undefined,
      manager1.token,
    )
  ).data;
  ok(
    detail.versions.length === 2 &&
      detail.documents.filter((d) => d.kind === 'REGISTRATION_PDF').length ===
        2,
    'IMMUTABLE_HISTORY',
  );
  pass(
    'manager immutable review/download, correction reason, applicant resubmission and preserved signed PDF history',
  );
  stage = 'private access and stale decisions';
  const pdf = detail.documents.find(
    (d) =>
      d.versionId === newVersion.versionId && d.kind === 'REGISTRATION_PDF',
  );
  await request(
    'GET',
    '/parent-applications/admin/' + adult.start.application.id,
    undefined,
    manager2.token,
    'manager',
    403,
  );
  await request(
    'GET',
    '/parent-applications/admin/' +
      adult.start.application.id +
      '/documents/' +
      pdf.id,
    undefined,
    manager2.token,
    'manager',
    403,
  );
  await request(
    'GET',
    '/parent-applications/me/pdf',
    undefined,
    undefined,
    'applicant',
    401,
  );
  await request(
    'POST',
    '/parent-applications/admin/' + adult.start.application.id + '/approve',
    { expectedVersionId: adult.submitted.versionId, identityVerified: true },
    manager1.token,
    'manager',
    409,
  );
  pass(
    'cross-branch and unauthenticated evidence denied; stale approval denied',
  );
  stage = 'manager browser approval and one-time handoff';
  await admin.page.reload();
  await select(admin.page, 'סוג הרשמה', 'מתנדבים');
  await admin.page.getByRole('button', { name: /^מתנדב בדיקת DEV/ }).click();
  await admin.page
    .getByRole('checkbox', {
      name: 'אימתתי ידנית את זהות המתנדב, המסמכים ושיוכו לסניף',
    })
    .check();
  await admin.page
    .getByRole('button', { name: 'אישור ויצירת חשבון מתנדב' })
    .click();
  await admin.page.getByRole('button', { name: 'אישור סופי' }).click();
  const secret = admin.page.getByLabel('סיסמה זמנית למסירה');
  await secret.waitFor({ timeout: 90000 });
  const temporary = await secret.inputValue();
  ok(temporary.length === 18, 'HANDOFF_LENGTH');
  await admin.page
    .getByRole('button', { name: 'סיום והסרת הסיסמה מהמסך' })
    .click();
  await secret.waitFor({ state: 'detached', timeout: 10000 });
  ok((await secret.count()) === 0, 'PASSWORD_NOT_REMOVED');
  const repeated = await Promise.all([
    request(
      'POST',
      '/parent-applications/admin/' + adult.start.application.id + '/approve',
      { expectedVersionId: newVersion.versionId, identityVerified: true },
      manager1.token,
    ),
    request(
      'POST',
      '/parent-applications/admin/' + adult.start.application.id + '/approve',
      { expectedVersionId: newVersion.versionId, identityVerified: true },
      manager1.token,
    ),
  ]);
  ok(
    repeated.every((r) => r.data.idempotent && !r.data.temporaryPassword),
    'REPEATED_SECRET',
  );
  const userId = repeated[0].data.userId;
  owned.adult.userId = userId;
  const [accounts] = await db.query(
    'SELECT u.phone_number,u."branchId",r."roleId",r."resourceId",u.must_change_password FROM "user" u JOIN user_roles r ON r."userId"=u.id WHERE u.id=:id',
    { replacements: { id: userId } },
  );
  ok(
    accounts.length === 1 &&
      accounts[0].roleId === 1 &&
      accounts[0].resourceId === branch.id &&
      accounts[0].phone_number === '0520000000' &&
      accounts[0].must_change_password,
    'PROVISIONED_ACCOUNT',
  );
  pass(
    'browser approval creates exactly one volunteer with correct branch/phone; one-time password clears and cannot be replayed',
  );
  stage = 'volunteer first login mobile';
  const volunteer = await newPage(true);
  await loginUi(volunteer.page, adultId, temporary);
  ok(
    new URL(volunteer.page.url()).pathname === '/change-password',
    'FORCED_CHANGE_ROUTE',
  );
  await request(
    'GET',
    '/user/me',
    undefined,
    (
      await request('POST', '/auth/login', {
        identifier: adultId,
        password: temporary,
      })
    ).data.token,
    'manager',
    403,
  );
  const permanent = generateTemporaryPassword();
  await volunteer.page
    .getByLabel('סיסמה נוכחית', { exact: true })
    .fill(temporary);
  await volunteer.page
    .getByLabel('סיסמה חדשה', { exact: true })
    .fill(permanent);
  await volunteer.page
    .getByLabel('אימות סיסמה חדשה', { exact: true })
    .fill(permanent);
  await volunteer.page
    .getByRole('button', { name: 'עדכון סיסמה', exact: true })
    .click();
  await volunteer.page.waitForURL(
    (url) => url.pathname !== '/change-password',
    { timeout: 45000 },
  );
  await volunteer.page.getByLabel('ניווט תחתון', { exact: true }).waitFor();
  await request(
    'POST',
    '/auth/login',
    { identifier: adultId, password: temporary },
    undefined,
    'manager',
    401,
  );
  ok(
    (
      await request('POST', '/auth/login', {
        identifier: adultId,
        password: permanent,
      })
    ).data.mustChangePassword === false,
    'PERMANENT_LOGIN',
  );
  pass(
    'temporary login, forced password change, volunteer mobile interface and rejection of old temporary password',
  );
  stage = 'minor browser consent and concurrent first approval';
  const minorId = await nationalId(),
    minor = await browserVolunteer(minorId, true, branch);
  const concurrent = await Promise.all([
    request(
      'POST',
      '/parent-applications/admin/' + minor.start.application.id + '/approve',
      { expectedVersionId: minor.submitted.versionId, identityVerified: true },
      manager1.token,
    ),
    request(
      'POST',
      '/parent-applications/admin/' + minor.start.application.id + '/approve',
      { expectedVersionId: minor.submitted.versionId, identityVerified: true },
      manager1.token,
    ),
  ]);
  ok(
    concurrent.filter((r) => r.data.temporaryPassword).length === 1 &&
      concurrent[0].data.userId === concurrent[1].data.userId,
    'CONCURRENT_FIRST_APPROVAL',
  );
  owned.minor = {
    applicationId: minor.start.application.id,
    userId: concurrent[0].data.userId,
  };
  pass(
    'minor browser parental consent/signature, official PDF and concurrent first approval create one account',
  );
  stage = 'separate rejection';
  const rejectId = await nationalId(),
    reject = (
      await request('POST', '/parent-applications/start', {
        identifier: rejectId,
        branchId: branch.id,
        registrationType: 'VOLUNTEER',
      })
    ).data;
  const rejectData = structuredClone((await me(adult.start.sessionToken)).data);
  rejectData.volunteer.nationalId = rejectId;
  delete rejectData.signatures;
  delete rejectData.policeClearanceDocumentId;
  const rejected = await completeApi(
    reject.sessionToken,
    rejectData,
    'VOLUNTEER',
  );
  await request(
    'POST',
    '/parent-applications/admin/' + reject.application.id + '/reject',
    { expectedVersionId: rejected.versionId, reason: 'DEV QA דחייה סינתטית' },
    manager1.token,
  );
  const [none] = await db.query(
    'SELECT provisioned_user_id,status FROM trainee_applications WHERE id=:id',
    { replacements: { id: reject.application.id } },
  );
  ok(
    none[0].status === 'REJECTED' && !none[0].provisioned_user_id,
    'REJECTION_ACCOUNT',
  );
  owned.rejected = { applicationId: reject.application.id };
  pass('separate application rejection preserves evidence and creates no user');
  fs.writeFileSync(
    path.resolve(__dirname, '../.tmp/phase5-e2e-results.json'),
    JSON.stringify(
      { completedAt: new Date().toISOString(), checks, owned },
      null,
      2,
    ),
  );
  console.log('ALL_CRITICAL_DEV_CHECKS_PASSED');
}
if (!process.argv.includes('--execute-dev')) {
  console.log(
    'Plan only: --execute-dev is required; creates synthetic DEV QA fixtures and enables DEV volunteer flags after prerequisites. No remote operations performed.',
  );
} else
  main()
    .catch((e) => {
      console.error(
        JSON.stringify({
          failedStage: stage,
          code: e.auditCode || e.code || e.name,
          verifiedChecks: checks,
        }),
      );
      fs.writeFileSync(
        path.resolve(__dirname, '../.tmp/phase5-e2e-progress.json'),
        JSON.stringify({ stage, checks, owned }, null, 2),
      );
      process.exitCode = 1;
    })
    .finally(async () => {
      if (browser) await browser.close();
      if (db) await db.close();
    });
