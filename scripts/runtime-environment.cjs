const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PRODUCTION_PROJECT_REF = 'tmlnuqrwhdeplpeuuvwv';
const DEVELOPMENT_PROJECT_REF = 'vlysppqfozfiwcmsyban';
const FORCED_FILE_KEYS = new Set(['NATIONAL_ID_ENCRYPTION_KEY']);

function normalizeBranchName(value) {
  const branch = value?.trim();
  if (!branch) {
    return undefined;
  }

  return branch
    .replace(/^refs\/heads\//, '')
    .replace(/^origin\//, '')
    .trim();
}

function detectGitBranch({ env = process.env, cwd = process.cwd() } = {}) {
  const environmentBranch = [
    env.RENDER_GIT_BRANCH,
    env.GITHUB_HEAD_REF,
    env.GITHUB_REF_NAME,
    env.CI_COMMIT_REF_NAME,
    env.BRANCH_NAME,
  ]
    .map(normalizeBranchName)
    .find(Boolean);

  if (environmentBranch) {
    return environmentBranch;
  }

  try {
    return normalizeBranchName(
      execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
  } catch {
    return undefined;
  }
}

function targetForBranch(branch) {
  return normalizeBranchName(branch) === 'main' ? 'production' : 'development';
}

function parseDotEnv(contents) {
  const values = {};

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    values[key] = rawValue.replace(/^["']|["']$/g, '');
  }

  return values;
}

function loadDotEnvFile(envFilePath, env = process.env) {
  if (!fs.existsSync(envFilePath)) {
    return false;
  }

  const values = parseDotEnv(fs.readFileSync(envFilePath, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (FORCED_FILE_KEYS.has(key) || !env[key]) {
      env[key] = value;
    }
  }

  return true;
}

function assertProjectTarget(target, env = process.env) {
  const expectedRef =
    target === 'production' ? PRODUCTION_PROJECT_REF : DEVELOPMENT_PROJECT_REF;
  const oppositeRef =
    target === 'production' ? DEVELOPMENT_PROJECT_REF : PRODUCTION_PROJECT_REF;

  for (const key of ['DB_USER', 'SUPABASE_URL']) {
    const value = env[key]?.trim();
    if (!value) {
      continue;
    }

    if (value.includes(oppositeRef) || !value.includes(expectedRef)) {
      throw new Error(
        `Refusing to start: ${key} does not match the ${target} Supabase project (${expectedRef}).`,
      );
    }
  }
}

function resolveRuntimeEnvironment({
  rootDir,
  env = process.env,
  branch,
} = {}) {
  if (!rootDir) {
    throw new Error('rootDir is required to resolve the runtime environment');
  }

  const resolvedBranch =
    normalizeBranchName(branch) ||
    detectGitBranch({ env, cwd: rootDir }) ||
    'unknown';
  const target = targetForBranch(resolvedBranch);
  const envFilePath = path.join(rootDir, `.env.${target}.local`);

  return { branch: resolvedBranch, target, envFilePath };
}

function loadRuntimeEnvironment(options = {}) {
  const runtime = resolveRuntimeEnvironment(options);
  const env = options.env || process.env;

  loadDotEnvFile(runtime.envFilePath, env);
  env.ETLAASOT_GIT_BRANCH = runtime.branch;
  env.ETLAASOT_RUNTIME_TARGET = runtime.target;
  assertProjectTarget(runtime.target, env);

  return runtime;
}

module.exports = {
  DEVELOPMENT_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  assertProjectTarget,
  detectGitBranch,
  loadRuntimeEnvironment,
  normalizeBranchName,
  resolveRuntimeEnvironment,
  targetForBranch,
};
