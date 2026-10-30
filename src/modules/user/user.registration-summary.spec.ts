import { Sequelize } from 'sequelize-typescript';
import UserService from './user.service';
import UserRepository from './user.repository';
import UserRoleService from '../user-role/user-role.service';

describe('Trainee list registration summaries', () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.NATIONAL_ID_HASH_SECRET = 'offline-registration-summary-secret';
    process.env.NATIONAL_ID_ENCRYPTION_KEY = '0'.repeat(64);
    process.env.PARENT_REGISTRATION_ENABLED = 'true';
    process.env.PARENT_ADMISSION_SCHEMA_READY = 'true';
  });
  afterEach(() => {
    process.env = { ...original };
  });
  function setup(count: number) {
    const trainees = Array.from({ length: count }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      branchId: 'selected-branch',
      name: 'Offline trainee',
    }));
    const query = jest
      .fn()
      .mockResolvedValue(
        count
          ? [
              {
                traineeUuid: trainees[0].id,
                status: 'APPROVED',
                source: 'RENEWAL',
                formId: '10000000-0000-4000-8000-000000000001',
                documentId: '20000000-0000-4000-8000-000000000001',
              },
            ]
          : [],
      );
    const getAllTrainees = jest.fn().mockResolvedValue(trainees);
    const service = new UserService(
      { query } as unknown as Sequelize,
      { getAllTrainees } as unknown as UserRepository,
      {} as UserRoleService,
    );
    return { service, query, getAllTrainees, trainees };
  }
  it('enriches a 500-row list with one batch query and preserves branch/archive scope', async () => {
    const { service, query, getAllTrainees } = setup(500);
    const rows = await service.getAllTrainees(
      'selected-branch',
      true,
      true,
      'archived',
      true,
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(getAllTrainees).toHaveBeenCalledWith(
      'selected-branch',
      true,
      true,
      'archived',
    );
    expect(rows).toHaveLength(500);
    expect(rows[0]).toMatchObject({
      parentRegistrationStatus: 'APPROVED',
      parentRegistrationPdf: {
        source: 'RENEWAL',
        formId: '10000000-0000-4000-8000-000000000001',
        documentId: '20000000-0000-4000-8000-000000000001',
      },
    });
    expect(rows[1]).toMatchObject({
      parentRegistrationStatus: null,
      parentRegistrationPdf: null,
    });
    expect(
      JSON.parse(query.mock.calls[0][1].replacements.trainees),
    ).toHaveLength(500);
  });
  it('does not expose registration metadata to non-admin list callers', async () => {
    const { service, query } = setup(3);
    const rows = await service.getAllTrainees(
      'selected-branch',
      false,
      false,
      'active',
      false,
    );
    expect(query).not.toHaveBeenCalled();
    expect(rows[0]).not.toHaveProperty('parentRegistrationStatus');
  });
  it('does not query disabled registration schemas or an empty list', async () => {
    const { service, query } = setup(0);
    await service.getAllTrainees('selected-branch', true, true, 'active', true);
    expect(query).not.toHaveBeenCalled();
    process.env.PARENT_REGISTRATION_ENABLED = 'false';
    const disabled = setup(1);
    const rows = await disabled.service.getAllTrainees(
      'selected-branch',
      true,
      true,
      'active',
      true,
    );
    expect(disabled.query).not.toHaveBeenCalled();
    expect(rows[0]).not.toHaveProperty('parentRegistrationStatus');
  });
});
