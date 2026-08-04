import { Injectable } from '@nestjs/common';
import { applyBranchDisplay } from 'src/constants/auth.constants';
import DashboardRepository from './dashboard.repository';
import type {
  SuperAdminBranchSummary,
  SuperAdminDashboardResponse,
} from './interfaces/dashboard.interface';

@Injectable()
export default class DashboardService {
  constructor(private readonly dashboardRepository: DashboardRepository) {}

  public async getSuperAdminDashboard(): Promise<SuperAdminDashboardResponse> {
    const branchRows =
      await this.dashboardRepository.getSuperAdminBranchSummaries();
    const branches = branchRows.map((branch) => {
      const displayBranch = applyBranchDisplay({
        id: branch.branchId,
        name: branch.branchName,
      });

      return {
        ...branch,
        branchName: displayBranch?.name ?? branch.branchName,
      };
    });

    return {
      totals: this.calculateTotals(branches),
      branches,
    };
  }

  private calculateTotals(branches: SuperAdminBranchSummary[]) {
    return branches.reduce(
      (totals, branch) => ({
        ...totals,
        activeVolunteers: totals.activeVolunteers + branch.activeVolunteers,
        activeTrainees: totals.activeTrainees + branch.activeTrainees,
        activeAssignments: totals.activeAssignments + branch.activeAssignments,
        unassignedTrainees:
          totals.unassignedTrainees + branch.unassignedTrainees,
        upcomingEvents: totals.upcomingEvents + branch.upcomingEvents,
      }),
      {
        activeBranches: branches.length,
        activeVolunteers: 0,
        activeTrainees: 0,
        activeAssignments: 0,
        unassignedTrainees: 0,
        upcomingEvents: 0,
      },
    );
  }
}
