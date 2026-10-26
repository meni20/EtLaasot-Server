import type { Sequelize } from 'sequelize-typescript';
import { RegistrationRepository } from './registration.repository';
import { RegistrationForm } from './entities/registration.entities';

describe('RegistrationRepository list PDF metadata', () => {
  afterEach(() => jest.restoreAllMocks());

  it('loads verified PDF references in one bounded query and exposes them only for READY rows', async () => {
    const rows = [
      {
        id: '10000000-0000-4000-8000-000000000001',
        documentStatus: 'READY',
        get: () => ({
          id: '10000000-0000-4000-8000-000000000001',
          documentStatus: 'READY',
        }),
      },
      {
        id: '10000000-0000-4000-8000-000000000002',
        documentStatus: 'PENDING',
        get: () => ({
          id: '10000000-0000-4000-8000-000000000002',
          documentStatus: 'PENDING',
        }),
      },
    ];
    jest.spyOn(RegistrationForm, 'findAndCountAll').mockResolvedValue({
      count: 2,
      rows,
    } as never);
    const query = jest.fn().mockResolvedValue([
      {
        formId: rows[0].id,
        documentId: '20000000-0000-4000-8000-000000000001',
      },
      {
        formId: rows[1].id,
        documentId: '20000000-0000-4000-8000-000000000002',
      },
    ]);
    const repo = new RegistrationRepository({ query } as unknown as Sequelize);

    const result = await repo.list({ page: 1, pageSize: 25 });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        replacements: { formIds: rows.map((row) => row.id) },
        logging: false,
      }),
    );
    expect(result.rows).toEqual([
      expect.objectContaining({
        id: rows[0].id,
        pdfDocumentId: '20000000-0000-4000-8000-000000000001',
      }),
      expect.objectContaining({ id: rows[1].id, pdfDocumentId: null }),
    ]);
  });
});
