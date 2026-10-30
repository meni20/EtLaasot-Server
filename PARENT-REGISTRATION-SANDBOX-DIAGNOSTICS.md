# Read-only sandbox diagnostics — 2026-10-20

Scope: the already provisioned Phase 2 cluster only. No database connection, SQL statement, migration, table creation, data modification, credential change, cluster recreation or service restart was performed during these diagnostics. No external services or PostgreSQL instances on ports 5432/5433 were contacted. No commit, push, deploy or merge occurred.

## Root cause

The attestation selected `inet_server_addr()::text AS address`, then required the returned string to equal `127.0.0.1`. PostgreSQL's explicit `inet`-to-`text` conversion includes the network mask, so the IPv4 host address is represented as `127.0.0.1/32`. That string necessarily fails the guard's exact equality check.

The smallest correction is `host(inet_server_addr()) AS address`, keeping the strict `address === '127.0.0.1'` requirement. No additional address is accepted. OS listener, process, socket, port, directory, nonce, cluster identifier, role, database and PostgreSQL version checks remain enforced.

PostgreSQL 17 documents both behaviors: [network address functions](https://www.postgresql.org/docs/17/functions-net.html). The failure was reproduced with the pure comparison function and the documented cast result, not by executing a live SQL query.

## Expected and observed evidence

| Field | Expected | Observed | Evidence |
| --- | --- | --- | --- |
| Data directory | `C:\Users\User\Et-Laasot-2\EtLaasot-Server\.tmp\parent-registration-postgres-20261020-a` | Same canonical directory | Manifest, real path, PID file, process `-D` argument, `postgres -C data_directory` |
| Executable | `C:\Program Files\PostgreSQL\17\bin\postgres.exe` | Exact match | Windows process inspection |
| Listener PID | Manifest/postmaster PID | 25032, exact match | Windows TCP listener and process inspection |
| Address | `127.0.0.1` | Exact match | Windows listener, PID file, configured listen address |
| Port | 55439 | Exact match | Windows listener, PID file, configured port |
| Cluster identifier | Manifest system identifier | Exact match | Read-only `pg_controldata` inspection |
| Cluster name | Manifest cluster name | Exact match | Read-only configured value inspection |
| Sandbox nonce | Exact manifest nonce | Matches configured value, 64 characters | Read-only config comparison; values redacted |
| Bootstrap database | `postgres` in this newly initialized cluster | Not freshly queried | Authenticated query cannot be repeated without bootstrap credential recovery |
| Bootstrap role | `etlaasot_sandbox_admin` | Not freshly queried | Same credential limitation |
| Original SQL address representation | Guard expected `127.0.0.1` | PostgreSQL-documented result is `127.0.0.1/32` | Code inspection, official docs, offline reproduction |

`postgres -C` reads configured values and exits; it does not query the running backend or guarantee that every configured value is currently applied. For directory, address and port, the running process/PID/listener evidence independently agrees with those values. Runtime SQL verification of nonce, role and database remains pending.

## Credential limitation

`phase2-credentials.dpapi` is absent. The original provisioning script persisted credentials only after its initial server attestation and database creation. That attestation failed first, so the random bootstrap password was not retained. The prior process did reach the server-comparison step, which means its authentication and read-only query succeeded at that time; its returned row was not recorded.

The address-formatting defect is deterministic, but without fresh authenticated SQL evidence these diagnostics cannot prove that it was the only mismatching field in the original row. No authentication safeguard was changed to work around the missing credential.

Recovering access to this existing sandbox requires separate authorization for sandbox credential/authentication changes. No such recovery was attempted. A future provisioning change should securely persist credentials before the first live attestation, so an intentional fail-closed abort does not lose access. That lifecycle change is separate from the one-line address correction.

## Local source changes and checks

- `scripts/parent-registration-sandbox.cjs`: use `host(inet_server_addr())`; report individual failed fields while always redacting nonce values. Keep all isolation checks.
- `scripts/diagnose-parent-registration-sandbox.cjs`: reproducible OS/config-only diagnostics; no PostgreSQL client or SQL execution.
- `scripts/parent-registration-attestation.test.cjs`: 13 pure offline checks passed, covering the address-format mismatch and rejection of wrong database, role, address, port, directory, nonce, cluster name, version and absent evidence.
- Both diagnostic/helper scripts passed Node syntax checks. `git diff --check` passed.

Commands executed:

```powershell
node --check scripts/parent-registration-sandbox.cjs
node --check scripts/diagnose-parent-registration-sandbox.cjs
node scripts/diagnose-parent-registration-sandbox.cjs
node --test scripts/parent-registration-attestation.test.cjs
git diff --check
```

The sandbox remains running and unchanged. Baseline installation, migration 030 and database integration tests were not resumed.
