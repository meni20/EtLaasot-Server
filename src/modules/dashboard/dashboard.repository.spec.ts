import { Sequelize } from 'sequelize-typescript';
import DashboardRepository from './dashboard.repository';

describe('DashboardRepository', () => {
  it('uses duplicate-safe aggregate queries without an event limit', async () => {
    const query = jest.fn().mockResolvedValue([
      {
        branchId: 'branch-1',
        branchName: 'Branch 1',
        activeVolunteers: '4',
        activeTrainees: '3',
        activeAssignments: '2',
        unassignedTrainees: '1',
        upcomingEvents: '125',
      },
    ]);
    const repository = new DashboardRepository({
      query,
    } as unknown as Sequelize);

    await expect(repository.getSuperAdminBranchSummaries()).resolves.toEqual([
      {
        branchId: 'branch-1',
        branchName: 'Branch 1',
        activeVolunteers: 4,
        activeTrainees: 3,
        activeAssignments: 2,
        unassignedTrainees: 1,
        upcomingEvents: 125,
      },
    ]);

    const sql = query.mock.calls[0][0] as string;
    expect(sql).toContain('COUNT(DISTINCT u.id)');
    expect(sql).toContain('COUNT(DISTINCT ma.id)');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('u.is_active = true');
    expect(sql).toContain('b."isActive" = true');
    expect(sql).toContain('e.start_date >= NOW()');
    expect(sql).not.toMatch(/\bLIMIT\b/i);
  });
});
