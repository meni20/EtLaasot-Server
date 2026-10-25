// Explicit DEV only; harmless synthetic PNG, removed from its exact scratch path.
const h = require('./volunteer-dev-target.cjs');
const fs = require('node:fs'),
  path = require('node:path'),
  { randomUUID, createHash } = require('node:crypto');
async function main() {
  if (!process.argv.includes('--execute-dev'))
    throw Error('EXPLICIT_DEV_EXECUTION_REQUIRED');
  h.status();
  const v = h.variables('server');
  h.assertDb(v);
  const claims = JSON.parse(
    Buffer.from(
      v.SUPABASE_SERVICE_ROLE_KEY.split('.')[1],
      'base64url',
    ).toString(),
  );
  if (claims.ref !== h.REF || claims.role !== 'service_role')
    throw Error('DEV_STORAGE_CREDENTIAL_MISMATCH');
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(v.SUPABASE_URL, v.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: require('ws') },
  });
  const bucket = 'trainee-documents',
    key = `phase5-qa-smoke/${randomUUID()}.png`,
    bytes = fs.readFileSync(
      path.resolve(__dirname, '../../EtLaasot-Documents/mock/signature.png'),
    );
  const meta = await sb.storage.getBucket(bucket);
  if (meta.error || meta.data.public !== false)
    throw Error('PRIVATE_BUCKET_REQUIRED');
  let uploaded = false;
  try {
    const put = await sb.storage
      .from(bucket)
      .upload(key, bytes, { contentType: 'image/png', upsert: false });
    if (put.error) throw Error('DEV_UPLOAD_FAILED');
    uploaded = true;
    const read = await sb.storage.from(bucket).download(key);
    if (read.error || !Buffer.from(await read.data.arrayBuffer()).equals(bytes))
      throw Error('DEV_READBACK_FAILED');
    const anon = await fetch(
      new URL(
        '/storage/v1/object/public/' + bucket + '/' + key,
        v.SUPABASE_URL,
      ),
    );
    if (anon.ok) throw Error('PUBLIC_EVIDENCE_ACCESS');
    console.log(
      JSON.stringify({
        privateBucket: true,
        upload: true,
        verifiedReadBack: true,
        anonymousPublicDenied: true,
      }),
    );
  } finally {
    if (uploaded) {
      const rm = await sb.storage.from(bucket).remove([key]);
      if (rm.error) throw Error('SCRATCH_CLEANUP_FAILED');
    }
  }
}
main().catch((e) => {
  console.error(
    /^[A-Z_]+$/.test(e.message) ? e.message : 'DEV_STORAGE_SMOKE_FAILED',
  );
  process.exitCode = 1;
});
