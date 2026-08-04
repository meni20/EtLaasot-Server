import DashboardRepository from './dashboard.repository';
import DashboardService from './dashboard.service';

describe('DashboardService', () => {
  it('derives organization totals from active branch summaries', async () => {
    const dashboardRepository = {
      getSuperAdminBranchSummaries: jest.fn().mockResolvedValue([
        {
          branchId: 'branch-a',
          branchName: 'Branch A',
          activeVolunteers: 4,
          activeTrainees: 3,
          activeAssignments: 2,
          unassignedTrainees: 1,
          upcomingEvents: 5,
        },
        {
          branchId: 'branch-b',
          branchName: 'Branch B',
          activeVolunteers: 6,
          activeTrainees: 7,
          activeAssignments: 4,
          unassignedTrainees: 3,
          upcomingEvents: 8,
        },
      ]),
    };
    const service = new DashboardService(
      dashboardRepository as unknown as DashboardRepository,
    );

    const result = await service.getSuperAdminDashboard();

    expect(result.totals).toEqual({
      activeBranches: 2,
      activeVolunteers: 10,
      activeTrainees: 10,
      activeAssignments: 6,
      unassignedTrainees: 4,
      upcomingEvents: 13,
    });
    expect(result.branches).toHaveLength(2);
  });
});
