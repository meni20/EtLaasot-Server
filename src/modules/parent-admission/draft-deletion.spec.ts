import { randomUUID } from 'crypto';
import { validate } from 'class-validator';
import { DraftDeletionService } from './draft-deletion.service';
import { DeleteDraftDto } from './admission.dto';
import { RegistrationIntegrationService } from '../parent-registration/registration-integration.service';
import { AuthorizationService } from '../auth/authorization.service';
import { Logger } from '@nestjs/common';

describe('Draft erasure Storage boundaries (offline)', () => {
  const id = randomUUID(),
    prefix = `registration/application/${id}`,
    hash = 'a'.repeat(64);
  let service: RegistrationIntegrationService;
  let list: jest.Mock, remove: jest.Mock;
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    list = jest.fn();
    remove = jest.fn(async () => ({ error: null }));
    service = new RegistrationIntegrationService({} as never);
    jest.spyOn(service, 'attest').mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'bucket')
      .mockResolvedValue({ store: { list, remove } });
  });
  afterEach(() => jest.restoreAllMocks());
  it('enumerates all pages and orphan uploads before deleting only the exact application prefix', async () => {
    let files = Array.from({ length: 205 }, () => ({
      name: randomUUID() + '.png',
      id: randomUUID(),
    }));
    list.mockImplementation(
      async (folder: string, options: { offset?: number; limit: number }) => ({
        error: null,
        data:
          folder === prefix
            ? files.length
              ? [{ name: hash, id: null }]
              : []
            : folder === `${prefix}/${hash}`
              ? [{ name: 'medical', id: null }]
              : files.slice(
                  options.offset ?? 0,
                  (options.offset ?? 0) + options.limit,
                ),
      }),
    );
    remove.mockImplementation(async (paths: string[]) => {
      files = files.filter(
        (f) => !paths.includes(`${prefix}/${hash}/medical/${f.name}`),
      );
      return { error: null };
    });
    await service.eraseUnsubmittedDraftFiles(id);
    expect(files).toHaveLength(0);
    expect(remove).toHaveBeenCalledTimes(3);
    expect(
      remove.mock.calls
        .flatMap((c) => c[0])
        .every((p: string) => p.startsWith(prefix + '/')),
    ).toBe(true);
    expect(list.mock.calls.some((c) => c[1].offset === 200)).toBe(true);
  });
  it('fails closed on ambiguous listing errors', async () => {
    list.mockResolvedValue({ data: null, error: { message: 'private' } });
    await expect(service.eraseUnsubmittedDraftFiles(id)).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });
  it('rejects traversal instead of deleting an unrelated file', async () => {
    list.mockResolvedValue({
      data: [{ name: '../other-app', id: 'object' }],
      error: null,
    });
    await expect(service.eraseUnsubmittedDraftFiles(id)).rejects.toThrow();
    expect(remove).not.toHaveBeenCalled();
  });
  it('does not treat a successful removal response as verified erasure', async () => {
    list.mockResolvedValue({
      data: [{ name: 'orphan.png', id: 'object' }],
      error: null,
    });
    await expect(service.eraseUnsubmittedDraftFiles(id)).rejects.toThrow();
    expect(remove).toHaveBeenCalledTimes(1);
  });
  it('propagates partial Storage failure for durable retry', async () => {
    list.mockResolvedValue({
      data: [{ name: 'orphan.png', id: 'object' }],
      error: null,
    });
    remove.mockResolvedValue({ error: { message: 'network' } });
    await expect(service.eraseUnsubmittedDraftFiles(id)).rejects.toThrow();
  });
});
describe('Draft erasure worker and confirmation (offline)', () => {
  it.each([undefined, false, 'true', 1])(
    'requires strict explicit confirmation %s',
    async (confirmed) => {
      const input = Object.assign(new DeleteDraftDto(), {
        expectedRevision: 0,
        confirmed,
      });
      expect(
        (await validate(input)).some((e) => e.property === 'confirmed'),
      ).toBe(true);
    },
  );
  it('never finalizes or claims success after Storage failure', async () => {
    const id = randomUUID();
    const query = jest.fn(async (sql: string) => [
      {
        result: sql.includes('to_regclass')
          ? true
          : sql.includes('draft_delete_claim')
            ? id
            : null,
      },
    ]);
    const integration = {
      enabled: () => true,
      eraseUnsubmittedDraftFiles: jest.fn(async () => {
        throw Error('secret-provider-error');
      }),
    };
    const log = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const service = new DraftDeletionService(
      { query } as never,
      integration as never,
      new AuthorizationService(),
    );
    try {
      await service.onModuleInit();
      await service.tick();
      expect(
        query.mock.calls.some((c) => c[0].includes('draft_delete_complete')),
      ).toBe(false);
      expect(
        query.mock.calls.some((c) => c[0].includes('draft_delete_fail')),
      ).toBe(true);
      expect(JSON.stringify(log.mock.calls)).not.toContain(
        'secret-provider-error',
      );
    } finally {
      service.onModuleDestroy();
      log.mockRestore();
    }
  });
  it('finalizes only after verified Storage cleanup', async () => {
    const order: string[] = [];
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('draft_delete_complete')) order.push('complete');
      return [
        {
          result: sql.includes('to_regclass')
            ? true
            : sql.includes('draft_delete_claim')
              ? randomUUID()
              : null,
        },
      ];
    });
    const integration = {
      enabled: () => true,
      eraseUnsubmittedDraftFiles: async () => {
        order.push('verified-storage');
      },
    };
    const service = new DraftDeletionService(
      { query } as never,
      integration as never,
      new AuthorizationService(),
    );
    try {
      await service.onModuleInit();
      await service.tick();
      expect(order).toEqual(['verified-storage', 'complete']);
    } finally {
      service.onModuleDestroy();
    }
  });
});
