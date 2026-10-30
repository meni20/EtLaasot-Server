// Safe startup diagnostics. Never include provider errors, environment values,
// connection strings or child-process arguments in a user-facing failure.
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');

const hints = Object.freeze({
  LOCAL_ENV_READ:
    'Cannot read or parse .env.development.local. Check its existence and permissions.',
  LOCAL_CONFIG_READ:
    'Cannot read or parse the protected local config. Run prepare-local.',
  LOCAL_CONFIG_INVALID:
    'The protected local config has an invalid structure. Restore it before continuing.',
  LOCAL_CONFIG_SAVE:
    'Cannot save the protected local config or apply its Windows ACL.',
  LOCAL_IDENTITY_UNAVAILABLE:
    'Cannot determine the current Windows user SID for the protected config ACL.',
  DEV_ATTESTATION_FAILED:
    'DEV identity, TLS or migration verification failed. No service was started.',
  ENCRYPTION_CONFIG_MISMATCH:
    'The existing DEV encryption configuration differs. No key was changed.',
  INTERNAL_API_KEY_INVALID:
    'The protected Documents key must be 64 hexadecimal characters with sufficient diversity. No key was printed or replaced.',
  PORT_IN_USE:
    'The required loopback port is already occupied. Reuse the verified running service or stop its owning process before restarting; no process was terminated.',
  PORT_UNAVAILABLE:
    'The required loopback port could not be bound. Check local socket permissions.',
  BUILD_MISSING:
    'The compiled entry point is missing. Run npm run build in the service repository.',
  RUNTIME_DEPENDENCY_MISSING:
    'A local runtime dependency is unavailable. Check the service node_modules.',
  TEMPLATE_FONT_INVALID:
    'Compiled template paths, Hebrew fonts or the fictional runtime fixture failed validation.',
  CHROME_LAUNCH_FAILED:
    'Playwright could not launch the installed Chrome channel. Check Chrome installation and local process permissions.',
  CHILD_SPAWN_FAILED: 'Node could not start the local service process.',
  CHILD_EXIT_FAILED:
    'The service process exited unsuccessfully. Check its redacted startup category above.',
  STARTUP_FAILED:
    'An unexpected local startup failure occurred. Secret-bearing error details were suppressed.',
});
class StartupError extends Error {
  constructor(category) {
    super(hints[category] || hints.STARTUP_FAILED);
    this.category = Object.hasOwn(hints, category)
      ? category
      : 'STARTUP_FAILED';
  }
}
async function step(category, operation) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof StartupError) throw error;
    throw new StartupError(category);
  }
}
function describe(error) {
  // Only accept our own allowlisted categories, never error.message/code from
  // PostgreSQL, filesystem, assertions, Playwright or a child process.
  const safe =
    error instanceof StartupError ? error : new StartupError('STARTUP_FAILED');
  return `[${safe.category}] ${safe.message}`;
}
function readConfig(file) {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw new StartupError('LOCAL_CONFIG_READ');
  }
  if (
    !config ||
    typeof config.env !== 'object' ||
    !config.env ||
    typeof config.suffix !== 'string' ||
    !Array.isArray(config.branches)
  ) {
    throw new StartupError('LOCAL_CONFIG_INVALID');
  }
  return config;
}
function validateKey(key) {
  if (
    typeof key !== 'string' ||
    !/^[a-fA-F0-9]{64}$/.test(key) ||
    new Set(key.toLowerCase()).size < 8
  ) {
    throw new StartupError('INTERNAL_API_KEY_INVALID');
  }
}
function windowsUserSid(exec = require('node:child_process').execFileSync) {
  // Account names can contain Hebrew and whoami can use the OEM code page.
  // A numeric SID is ASCII in either encoding; icacls accepts it with a '*'.
  let sids;
  try {
    const output = exec('whoami', ['/user', '/fo', 'csv', '/nh'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    sids = String(output).match(/S-1-\d+(?:-\d+)+/g);
  } catch {
    throw new StartupError('LOCAL_IDENTITY_UNAVAILABLE');
  }
  if (sids?.length !== 1) throw new StartupError('LOCAL_IDENTITY_UNAVAILABLE');
  return '*' + sids[0];
}
async function checkPort(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error) =>
      reject(
        new StartupError(
          error.code === 'EADDRINUSE' ? 'PORT_IN_USE' : 'PORT_UNAVAILABLE',
        ),
      ),
    );
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close((error) =>
        error ? reject(new StartupError('PORT_UNAVAILABLE')) : resolve(),
      );
    });
  });
}
async function checkDocuments(cwd) {
  const { pathToFileURL } = require('node:url');
  const { createRequire } = require('node:module');
  const localRequire = createRequire(path.join(cwd, 'package.json'));
  const chromium = await step(
    'RUNTIME_DEPENDENCY_MISSING',
    () => localRequire('playwright').chromium,
  );
  await step('TEMPLATE_FONT_INVALID', async () => {
    const { checkRuntime } = await import(
      pathToFileURL(path.join(cwd, 'scripts/check-runtime.mjs')).href
    );
    await checkRuntime();
  });
  await step('CHROME_LAUNCH_FAILED', async () => {
    const browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      timeout: 15000,
    });
    try {
      const page = await browser.newPage();
      await page.setContent('<html><body>Local startup check</body></html>');
      const pdf = await page.pdf({ format: 'A4' });
      if (pdf.subarray(0, 5).toString() !== '%PDF-') throw new Error();
    } finally {
      await browser.close();
    }
  });
}
module.exports = {
  StartupError,
  step,
  describe,
  readConfig,
  validateKey,
  windowsUserSid,
  checkPort,
  checkDocuments,
};
