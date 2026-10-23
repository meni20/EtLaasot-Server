// Read-only PostgreSQL check of the actual batch status query using in-memory
// CTE fixtures. Creates no tables, users, registrations or other database rows.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { attest, file, root } = require('./phase5-local.cjs');
async function run() {
  const env = JSON.parse(fs.readFileSync(file, 'utf8')).env;
  await attest(env);
  const client = new Client({
    host: env.DB_HOST,
    port: 5432,
    database: env.DB_NAME,
    user: env.DB_USER,
    password: env.DB_PASS,
    ssl: {
      rejectUnauthorized: true,
      ca: fs.readFileSync(path.resolve(root, env.DB_SSL_CA_PATH), 'utf8'),
    },
  });
  const current = randomUUID(),
    old = randomUUID();
  const data = {
    years: [
      {
        id: current,
        is_active: true,
        starts_on: '2000-01-01',
        ends_on: '9999-12-31',
      },
      {
        id: old,
        is_active: false,
        starts_on: '1990-01-01',
        ends_on: '1999-12-31',
      },
    ],
    forms: [],
    formVersions: [],
    formDocuments: [],
    periods: [],
    applications: [],
    applicationVersions: [],
    applicationEvidence: [],
  };
  const trainees = [],
    expected = new Map();
  const add = (status) => {
    const id = randomUUID();
    trainees.push({ id, branchId: 'selected' });
    expected.set(id, status);
    return id;
  };
  const form = (user, status, extra = {}) => {
    const id = randomUUID();
    data.forms.push({
      id,
      trainee_uuid: user,
      branch_id: 'selected',
      activity_year_id: current,
      request_type: 'YEARLY',
      status,
      updated_at: '2026-01-01T00:00:00Z',
      approved_at: null,
      ...extra,
    });
    if (status === 'APPROVED') {
      const versionId = randomUUID();
      data.formVersions.push({ id: versionId, form_id: id, version_number: 1 });
      data.formDocuments.push({
        id: randomUUID(),
        form_id: id,
        version_id: versionId,
        kind: 'REGISTRATION_PDF',
        mime_type: 'application/pdf',
        verified_at: '2026-01-01T00:00:00Z',
      });
    }
    return id;
  };
  add(null);
  form(add('DRAFT'), 'DRAFT');
  const pending = add('PENDING_REVIEW');
  form(pending, 'APPROVED');
  form(pending, 'PENDING_REVIEW');
  form(add('CHANGES_REQUESTED'), 'CHANGES_REQUESTED');
  const approvedRenewal = add('APPROVED');
  form(approvedRenewal, 'APPROVED');
  form(add(null), 'APPROVED', { activity_year_id: old });
  form(add(null), 'APPROVED', { branch_id: 'other' });
  const application = add('APPROVED');
  const applicationId = randomUUID();
  data.applications.push({
    id: applicationId,
    provisioned_user_id: application,
    branch_id: 'selected',
    approved_activity_year_id: current,
    status: 'APPROVED',
    reviewed_at: '2026-01-01T00:00:00Z',
  });
  const applicationVersionId = randomUUID();
  data.applicationVersions.push({
    id: applicationVersionId,
    application_id: applicationId,
    version_number: 1,
  });
  data.applicationEvidence.push({
    id: randomUUID(),
    application_id: applicationId,
    version_id: applicationVersionId,
    kind: 'REGISTRATION_PDF',
    mime_type: 'application/pdf',
    verified_at: '2026-01-01T00:00:00Z',
  });
  form(add(null), 'APPROVED', { request_type: 'INDIVIDUAL' });
  data.periods.push({
    branch_id: 'selected',
    activity_year_id: current,
    status: 'OPEN',
  });
  const individual = add('APPROVED');
  trainees.find((t) => t.id === individual).branchId = 'closed-branch';
  form(individual, 'APPROVED', {
    branch_id: 'closed-branch',
    request_type: 'INDIVIDUAL',
  });
  form(add('DRAFT'), 'DRAFT', { activity_year_id: old });
  const unrelated = randomUUID();
  form(unrelated, 'APPROVED');
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const identity = (
      await client.query(
        "SELECT current_database()='postgres' AND current_user='etlaasot_app' AND inet_server_addr()='2a05:d014:8ef:5902:b67d:7199:8fac:e6d0'::inet AND inet_server_port()=5432 AS ok",
      )
    ).rows[0];
    assert.equal(identity.ok, true);
    assert.equal(client.connection.stream.authorized, true);
    const {
      traineeFormStatuses,
    } = require('../dist/modules/parent-registration/registration.repository.js');
    const before = process.env.PARENT_ADMISSION_SCHEMA_READY;
    process.env.PARENT_ADMISSION_SCHEMA_READY = 'true';
    try {
      let queries = 0;
      const result = await traineeFormStatuses(
        {
          query: async (sql, options) => {
            queries++;
            let query = sql
              .replaceAll('public.registration_form_versions', 'test_form_versions')
              .replaceAll('public.registration_form_documents', 'test_form_documents')
              .replaceAll('public.trainee_application_versions', 'test_application_versions')
              .replaceAll('public.trainee_application_evidence', 'test_application_evidence')
              .replaceAll('public.activity_years', 'test_years')
              .replaceAll('public.registration_forms', 'test_forms')
              .replaceAll('public.branch_registration_periods', 'test_periods')
              .replaceAll('public.trainee_applications', 'test_applications');
            query = query.replace(
              'WITH listed AS (',
              `WITH test_years AS (SELECT * FROM jsonb_to_recordset($4::jsonb->'years') AS x(id uuid,is_active boolean,starts_on date,ends_on date)), test_forms AS (SELECT * FROM jsonb_to_recordset($4::jsonb->'forms') AS x(id uuid,trainee_uuid uuid,branch_id text,activity_year_id uuid,request_type text,status text,updated_at timestamptz,approved_at timestamptz)), test_form_versions AS (SELECT * FROM jsonb_to_recordset($4::jsonb->'formVersions') AS x(id uuid,form_id uuid,version_number integer)), test_form_documents AS (SELECT * FROM jsonb_to_recordset($4::jsonb->'formDocuments') AS x(id uuid,form_id uuid,version_id uuid,kind text,mime_type text,verified_at timestamptz)), test_periods AS (SELECT * FROM jsonb_to_recordset($4::jsonb->'periods') AS x(branch_id text,activity_year_id uuid,status text)), test_applications AS (SELECT * FROM jsonb_to_recordset($4::jsonb->'applications') AS x(id uuid,provisioned_user_id uuid,branch_id text,approved_activity_year_id uuid,status text,reviewed_at timestamptz)), test_application_versions AS (SELECT * FROM jsonb_to_recordset($4::jsonb->'applicationVersions') AS x(id uuid,application_id uuid,version_number integer)), test_application_evidence AS (SELECT * FROM jsonb_to_recordset($4::jsonb->'applicationEvidence') AS x(id uuid,application_id uuid,version_id uuid,kind text,mime_type text,verified_at timestamptz)), listed AS (`,
            );
            query = query
              .replaceAll(':trainees', '$1')
              .replaceAll(':today', '$2')
              .replaceAll(
                ':active',
                'SELECT jsonb_array_elements_text($3::jsonb)',
              );
            return (
              await client.query(query, [
                options.replacements.trainees,
                options.replacements.today,
                JSON.stringify(options.replacements.active),
                JSON.stringify(data),
              ])
            ).rows;
          },
        },
        trainees,
      );
      assert.equal(queries, 1);
      for (const [id, status] of expected)
        assert.equal(result.get(id)?.status ?? null, status);
      assert.equal(result.get(approvedRenewal)?.pdf?.source, 'RENEWAL');
      assert.equal(result.get(application)?.pdf?.source, 'APPLICATION');
      assert.equal(result.get(pending)?.pdf, null);
      assert.equal(result.has(unrelated), false);
      console.log(
        JSON.stringify({
          status: 'PASS',
          readOnly: true,
          syntheticCases: expected.size,
          statusQueries: queries,
          existingDataModified: false,
        }),
      );
    } finally {
      if (before === undefined)
        delete process.env.PARENT_ADMISSION_SCHEMA_READY;
      else process.env.PARENT_ADMISSION_SCHEMA_READY = before;
    }
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
}
run().catch(() => {
  console.error(
    'Read-only registration status check failed; values and provider details redacted.',
  );
  process.exitCode = 1;
});
