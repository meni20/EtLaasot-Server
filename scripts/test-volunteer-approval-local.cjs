// Fresh loopback-only PostgreSQL + real local Documents, synthetic identities only.
process.argv.push('--phase2', '--phase3', '--phase4');
require('./test-volunteer-infrastructure-local.cjs');
