const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { randomBytes } = require('node:crypto');
const {
  StartupError,
  validateKey,
  windowsUserSid,
  checkPort,
  step,
  describe,
} = require('./phase5-startup.cjs');

test('internal key validation keeps authentication strict and redacts values', () => {
  for (const key of [
    undefined,
    '',
    'a'.repeat(64),
    'short-secret',
    'z'.repeat(64),
  ]) {
    assert.throws(
      () => validateKey(key),
      (error) => {
        assert.equal(error.category, 'INTERNAL_API_KEY_INVALID');
        if (key) assert.ok(!describe(error).includes(key));
        return true;
      },
    );
  }
  validateKey(randomBytes(32).toString('hex'));
});
test('occupied port fails without terminating or reusing the owner', async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await assert.rejects(
      checkPort(port),
      (error) => error.category === 'PORT_IN_USE',
    );
    assert.equal(server.listening, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  await checkPort(port);
});
test('stage diagnostics never expose raw provider errors or connection strings', async () => {
  const secret = 'postgres://sensitive-credentials@private-host';
  await assert.rejects(
    step('DEV_ATTESTATION_FAILED', () => {
      throw new Error(secret);
    }),
    (error) => {
      assert.match(describe(error), /\[DEV_ATTESTATION_FAILED\]/);
      assert.ok(!describe(error).includes(secret));
      return true;
    },
  );
  assert.ok(!describe(new Error(secret)).includes(secret));
  assert.equal(new StartupError(secret).category, 'STARTUP_FAILED');
});
test('ACL identity uses ASCII SID even when the Hebrew account name is OEM-encoded', () => {
  const sid = 'S-1-5-21-111-222-333-1001';
  const oem = Buffer.concat([
    Buffer.from([0x8e, 0x90, 0x89]),
    Buffer.from(`\\user,${sid}\r\n`),
  ]).toString('utf8');
  assert.equal(
    windowsUserSid(() => oem),
    '*' + sid,
  );
  for (const output of ['', 'unresolvable-account', sid + ',' + sid]) {
    assert.throws(
      () => windowsUserSid(() => output),
      (error) => error.category === 'LOCAL_IDENTITY_UNAVAILABLE',
    );
  }
});
