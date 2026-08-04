export interface SuperAdminBranchSummary {
  branchId: string;
  branchName: string;
  activeVolunteers: number;
  activeTrainees: number;
  activeAssignments: number;
  unassignedTrainees: number;
  upcomingEvents: number;
}

export interface SuperAdminDashboardTotals {
  activeBranches: number;
  activeVolunteers: number;
  activeTrainees: number;
  activeAssignments: number;
  unassignedTrainees: number;
  upcomingEvents: number;
}

export interface SuperAdminDashboardResponse {
  totals: SuperAdminDashboardTotals;
  branches: SuperAdminBranchSummary[];
}
