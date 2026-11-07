import { readFileSync, readdirSync } from 'fs';
import { randomBytes, randomUUID } from 'crypto';
import { Sequelize } from 'sequelize-typescript';
import { QueryTypes, Transaction } from 'sequelize';

const nonce = process.env.ONBOARDING_ISOLATED_NONCE;
const url = process.env.ONBOARDING_TEST_DATABASE_URL;
const integration = nonce && url ? describe : describe.skip;
integration('Permanent draft deletion — isolated real PostgreSQL', () => {
  let db: Sequelize;
  const manager = randomUUID(),
    other = randomUUID(),
    superAdmin = randomUUID(),
    volunteer = randomUUID();
  const q = async (
    sql: string,
    replacements: Record<string, unknown> = {},
    transaction?: Transaction,
  ) =>
    db.query<any>(sql, {
      replacements,
      transaction,
      type: QueryTypes.SELECT,
      logging: false,
    });
  const app = async (sql: string, replacements: Record<string, unknown> = {}) =>
    db.transaction(async (t) => {
      await db.query('SET LOCAL ROLE etlaasot_app', {
        transaction: t,
        logging: false,
      });
      return q(sql, replacements, t);
    });
  const rpc = (name: string, args: string, values: Record<string, unknown>) =>
    app(`SELECT registration_private.${name}(${args}) AS value`, values);
  const begin = (id: string, actor = manager, revision = 0) =>
    rpc(
      'draft_delete_begin',
      'CAST(:id AS uuid),CAST(:actor AS uuid),:revision',
      { id, actor, revision },
    );
  const claim = (c: string) =>
    rpc('draft_delete_claim', 'CAST(:claim AS uuid)', { claim: c });
  const finish = (id: string, c: string) =>
    rpc('draft_delete_complete', 'CAST(:id AS uuid),CAST(:claim AS uuid)', {
      id,
      claim: c,
    });
  beforeAll(async () => {
    if (
      !/^[a-f0-9]{16}$/.test(nonce!) ||
      url !== `postgres://postgres@127.0.0.1:55447/onboarding_test_${nonce}`
    )
      throw Error('Fresh isolated loopback database required');
    db = new Sequelize(url!, {
      dialect: 'postgres',
      logging: false,
      pool: { max: 6 },
    });
    await db.query(
      'CREATE ROLE etlaasot_app; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA storage; CREATE TABLE storage.objects(id uuid DEFAULT gen_random_uuid(),bucket_id text,name text);',
      { logging: false },
    );
    await db.query(
      readFileSync('test/parent-registration/baseline.sql', 'utf8'),
      { logging: false },
    );
    for (const name of readdirSync('migrations')
      .filter((n) => /^03[0-8]_/.test(n))
      .sort())
      await db.query(readFileSync('migrations/' + name, 'utf8'), {
        logging: false,
      });
    await q(
      "INSERT INTO public.branch(id,name) VALUES('a','Fictional A'),('b','Fictional B'); INSERT INTO public.roles(id,name) VALUES(1,'VOLUNTEER'),(2,'TRAINEE'),(10000,'BRANCH_ADMIN'),(10001,'SUPER_ADMIN')",
    );
    for (const [id, role, branch] of [
      [manager, 10000, 'a'],
      [other, 10000, 'b'],
      [superAdmin, 10001, 'b'],
      [volunteer, 1, 'a'],
    ]) {
      await q(
        'INSERT INTO public."user"(id,name,"branchId") VALUES(:id,:name,:branch)',
        { id, name: 'Fictional erasure test', branch },
      );
      await q(
        'INSERT INTO public.user_roles("userId","roleId","resourceId") VALUES(:id,:role,:branch)',
        { id, role, branch },
      );
    }
  });
  afterAll(async () => {
    if (db) await db.close();
  });
  beforeEach(async () => {
    await db.query(
      'TRUNCATE public.registration_draft_deletions,public.trainee_application_evidence,public.trainee_application_events,public.trainee_application_versions,public.applicant_sessions,public.onboarding_deliveries,public.trainee_applications,storage.objects CASCADE',
      { logging: false },
    );
  });
  async function seed(
    type = 'TRAINEE',
    hash = randomBytes(32).toString('hex'),
  ) {
    const id = randomUUID(),
      file = `registration/application/${id}/${'a'.repeat(64)}/medical/${randomUUID()}.png`;
    await q(
      "INSERT INTO public.trainee_applications(id,national_id_hash,national_id_encrypted,branch_id,registration_type,draft_data) VALUES(:id,:hash,'synthetic encrypted identity','a',:type,'{\"synthetic\":\"personal draft payload\"}')",
      { id, hash, type },
    );
    await q(
      "INSERT INTO public.applicant_sessions(application_id,token_hash,recovery_hash,expires_at,recovery_expires_at) VALUES(:id,:token,:recovery,now()+interval '1 day',now()+interval '90 days')",
      {
        id,
        token: randomBytes(32).toString('hex'),
        recovery: randomBytes(32).toString('hex'),
      },
    );
    await q(
      "INSERT INTO public.trainee_application_events(application_id,action) VALUES(:id,'CREATED')",
      { id },
    );
    await q(
      "INSERT INTO public.trainee_application_evidence(application_id,registration_type,kind,storage_bucket,storage_path,mime_type,file_size,checksum,content_hash,verified_at) VALUES(:id,:type,:kind,'trainee-documents',:file,'image/png',100,:hash,:hash,now())",
      {
        id,
        type,
        kind: type === 'TRAINEE' ? 'PHYSICIAN_SUMMARY' : 'POLICE_CLEARANCE',
        file,
        hash: 'a'.repeat(64),
      },
    );
    return { id, hash, file };
  }
  it.each(['TRAINEE', 'VOLUNTEER'])(
    'erases %s without retaining content, and releases the same identity for a new UUID',
    async (type) => {
      const { id, hash } = await seed(type);
      await begin(id);
      expect(
        (
          await q(
            'SELECT count(*)::int AS n FROM public.applicant_sessions WHERE application_id=:id',
            { id },
          )
        )[0].n,
      ).toBe(0);
      const [row] = await q(
        'SELECT draft_data,national_id_encrypted FROM public.trainee_applications WHERE id=:id',
        { id },
      );
      expect(row).toEqual({ draft_data: {}, national_id_encrypted: '' });
      await expect(seed(type, hash)).rejects.toThrow(); // identity is not prematurely released
      const c = randomUUID();
      await claim(c);
      await finish(id, c);
      for (const table of [
        'trainee_applications',
        'applicant_sessions',
        'trainee_application_evidence',
        'trainee_application_events',
        'trainee_application_versions',
      ]) {
        const col = table === 'trainee_applications' ? 'id' : 'application_id';
        expect(
          (
            await q(
              `SELECT count(*)::int AS n FROM public.${table} WHERE ${col}=:id`,
              { id },
            )
          )[0].n,
        ).toBe(0);
      }
      const next = await seed(type, hash);
      expect(next.id).not.toBe(id);
      const [audit] = await q(
        'SELECT * FROM public.registration_draft_deletions WHERE application_id=:id',
        { id },
      );
      expect(audit.status).toBe('COMPLETE');
      expect(JSON.stringify(audit)).not.toContain(hash);
      expect(JSON.stringify(audit)).not.toContain('personal draft payload');
    },
  );
  it.each([other, volunteer])(
    'denies an unauthorized or cross-branch actor',
    async (actor) => {
      const { id } = await seed();
      await expect(begin(id, actor)).rejects.toMatchObject({
        original: { code: '42501' },
      });
      expect(
        (await q('SELECT count(*)::int AS n FROM public.applicant_sessions'))[0]
          .n,
      ).toBe(1);
    },
  );
  it('allows SUPER_ADMIN without moving the application branch', async () => {
    const { id } = await seed();
    await begin(id, superAdmin);
    expect(
      (await q('SELECT branch_id FROM public.registration_draft_deletions'))[0]
        .branch_id,
    ).toBe('a');
  });
  it('rejects stale revisions without invalidating credentials', async () => {
    const { id } = await seed();
    await expect(begin(id, manager, 4)).rejects.toThrow();
    expect(
      (await q('SELECT count(*)::int AS n FROM public.applicant_sessions'))[0]
        .n,
    ).toBe(1);
  });
  it.each(['PENDING_REVIEW', 'CHANGES_REQUESTED', 'REJECTED'])(
    'never deletes %s',
    async (status) => {
      const { id } = await seed();
      await q(
        "UPDATE public.trainee_applications SET status=:status,feedback_reason='synthetic review' WHERE id=:id",
        { id, status },
      );
      await expect(begin(id)).rejects.toThrow();
    },
  );
  it('rejects reviewed, provisioned, historical-submission and already-existing account identities', async () => {
    const { id, hash } = await seed();
    await q(
      'UPDATE public.trainee_applications SET reviewed_by=:actor,reviewed_at=now() WHERE id=:id',
      { id, actor: manager },
    );
    await expect(begin(id)).rejects.toThrow();
    await q(
      'UPDATE public.trainee_applications SET reviewed_by=NULL,reviewed_at=NULL,provisioned_user_id=:actor WHERE id=:id',
      { id, actor: manager },
    );
    await expect(begin(id)).rejects.toThrow();
    await q(
      'UPDATE public.trainee_applications SET provisioned_user_id=NULL WHERE id=:id',
      { id },
    );
    await q('UPDATE public."user" SET national_id_hash=:hash WHERE id=:actor', {
      hash,
      actor: manager,
    });
    await expect(begin(id)).rejects.toThrow();
    await q('UPDATE public."user" SET national_id_hash=NULL WHERE id=:actor', {
      actor: manager,
    });
    await q(
      "INSERT INTO public.trainee_application_events(application_id,action) VALUES(:id,'SUBMITTED')",
      { id },
    );
    await expect(begin(id)).rejects.toThrow();
  });
  it('retains immutability outside the narrowly scoped finalizer and grants no app DELETE', async () => {
    await seed();
    await expect(
      q('DELETE FROM public.trainee_application_evidence'),
    ).rejects.toThrow('immutable');
    await expect(
      app('DELETE FROM public.trainee_applications'),
    ).rejects.toMatchObject({ original: { code: '42501' } });
    await expect(
      app(
        'UPDATE public.registration_draft_deletions SET purge_xid=txid_current()',
      ),
    ).rejects.toMatchObject({ original: { code: '42501' } });
  });
  it('protects immutable submitted versions even if an inconsistent parent is still marked DRAFT', async () => {
    const { id } = await seed();
    await q(
      "INSERT INTO public.trainee_application_versions(application_id,version_number,submitted_revision,idempotency_key,form_data,content_hash,declarations,declaration_version,template_version) VALUES(:id,1,0,:key,'{}',:hash,:decl,'test','test')",
      {
        id,
        key: randomUUID(),
        hash: 'a'.repeat(64),
        decl: JSON.stringify(Array(10).fill('synthetic')),
      },
    );
    await expect(begin(id)).rejects.toThrow();
    await expect(
      q(
        'DELETE FROM public.trainee_application_versions WHERE application_id=:id',
        { id },
      ),
    ).rejects.toThrow('immutable');
  });
  it('a concurrent submission winning the existing locks prevents deletion', async () => {
    const { id } = await seed();
    const t = await db.transaction();
    await q(
      'SELECT * FROM public.applicant_sessions WHERE application_id=:id FOR UPDATE',
      { id },
      t,
    );
    await q(
      'SELECT id FROM public.trainee_applications WHERE id=:id FOR UPDATE',
      { id },
      t,
    );
    const deleting = begin(id).then(
      () => false,
      () => true,
    );
    await q(
      "UPDATE public.trainee_applications SET status='PENDING_REVIEW' WHERE id=:id",
      { id },
      t,
    );
    await t.commit();
    expect(await deleting).toBe(true);
    expect(
      (await q('SELECT count(*)::int AS n FROM public.applicant_sessions'))[0]
        .n,
    ).toBe(1);
  });
  it('cannot report COMPLETE with remaining storage metadata; retries are idempotent', async () => {
    const { id, file } = await seed();
    await q(
      "INSERT INTO storage.objects(bucket_id,name) VALUES('trainee-documents',:file)",
      { file },
    );
    await begin(id);
    const c = randomUUID();
    await claim(c);
    await expect(finish(id, c)).rejects.toThrow('incomplete');
    expect(
      (await q('SELECT count(*)::int AS n FROM public.trainee_applications'))[0]
        .n,
    ).toBe(1);
    await q('DELETE FROM storage.objects'); // simulated successful Storage API in this isolated schema only
    await finish(id, c);
    await begin(id);
    expect(
      (
        await q(
          'SELECT count(*)::int AS n FROM public.registration_draft_deletions',
        )
      )[0].n,
    ).toBe(1);
  });
  it('freezes saves, submissions, credential recreation and uploads once deletion starts', async () => {
    const { id } = await seed();
    await begin(id);
    await expect(
      q(
        "UPDATE public.trainee_applications SET status='PENDING_REVIEW' WHERE id=:id",
        { id },
      ),
    ).rejects.toThrow('irreversible');
    await expect(
      q(
        'INSERT INTO public.applicant_sessions(application_id,token_hash,recovery_hash,expires_at,recovery_expires_at) VALUES(:id,:h,:h,now(),now())',
        { id, h: 'b'.repeat(64) },
      ),
    ).rejects.toThrow('unavailable');
    await expect(
      q(
        "INSERT INTO public.trainee_application_evidence(application_id,kind,storage_bucket,storage_path,mime_type,file_size,checksum,content_hash,verified_at) VALUES(:id,'PHYSICIAN_SUMMARY','trainee-documents','late-file','image/png',10,:h,:h,now())",
        { id, h: 'b'.repeat(64) },
      ),
    ).rejects.toThrow('unavailable');
  });
  it('serializes duplicate requests and permits only one worker lease', async () => {
    const { id } = await seed();
    await Promise.all([begin(id), begin(id)]);
    const claims = await Promise.all([
      claim(randomUUID()),
      claim(randomUUID()),
    ]);
    expect(claims.filter((x) => x[0].value !== null)).toHaveLength(1);
    expect(
      (
        await q(
          'SELECT count(*)::int AS n FROM public.registration_draft_deletions',
        )
      )[0].n,
    ).toBe(1);
  });
  it('recovers expired leases and allows a manager to retry a bounded failure', async () => {
    const { id } = await seed();
    await begin(id);
    await claim(randomUUID());
    await q(
      "UPDATE public.registration_draft_deletions SET lease_until=now()-interval '1 second',attempts=5",
    );
    expect((await claim(randomUUID()))[0].value).toBeNull();
    expect(
      (await q('SELECT status FROM public.registration_draft_deletions'))[0]
        .status,
    ).toBe('FAILED');
    await begin(id);
    expect((await claim(randomUUID()))[0].value).toBe(id);
  });
});
