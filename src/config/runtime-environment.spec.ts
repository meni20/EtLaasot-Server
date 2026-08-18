const path = require('path');
const {
  assertProjectTarget,
  detectGitBranch,
  resolveRuntimeEnvironment,
  targetForBranch,
} = require('../../scripts/runtime-environment.cjs');

describe('runtime environment selection', () => {
  const rootDir = path.resolve(__dirname, '..', '..');

  it('uses production only for the exact main branch', () => {
    expect(targetForBranch('main')).toBe('production');
    expect(targetForBranch('refs/heads/main')).toBe('production');
    expect(targetForBranch('feature/safe-change')).toBe('development');
    expect(targetForBranch(undefined)).toBe('development');
  });

  it('prefers Render branch metadata over local Git state', () => {
    expect(
      detectGitBranch({
        env: { RENDER_GIT_BRANCH: 'feature/render-preview' },
        cwd: rootDir,
      }),
    ).toBe('feature/render-preview');
  });

  it('selects the matching branch-specific secret file', () => {
    const production = resolveRuntimeEnvironment({
      rootDir,
      env: {},
      branch: 'main',
    });
    const development = resolveRuntimeEnvironment({
      rootDir,
      env: {},
      branch: 'agent/safe-change',
    });

    expect(production.target).toBe('production');
    expect(production.envFilePath).toBe(
      path.join(rootDir, '.env.production.local'),
    );
    expect(development.target).toBe('development');
    expect(development.envFilePath).toBe(
      path.join(rootDir, '.env.development.local'),
    );
  });

  it('fails closed when development points at production', () => {
    expect(() =>
      assertProjectTarget('development', {
        DB_USER: 'etlaasot_app.tmlnuqrwhdeplpeuuvwv',
        SUPABASE_URL: 'https://tmlnuqrwhdeplpeuuvwv.supabase.co',
      }),
    ).toThrow('Refusing to start');
  });

  it('accepts the matching development project', () => {
    expect(() =>
      assertProjectTarget('development', {
        DB_USER: 'etlaasot_app.vlysppqfozfiwcmsyban',
        SUPABASE_URL: 'https://vlysppqfozfiwcmsyban.supabase.co',
      }),
    ).not.toThrow();
  });
});
