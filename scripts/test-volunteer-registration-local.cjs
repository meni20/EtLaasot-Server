// Uses the existing fresh-cluster runner; never targets an application database.
process.argv.push('--phase2');
require('./test-volunteer-infrastructure-local.cjs');
