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
  pwaInstallations: number;
  pwaUniqueInstallers: number;
}

export interface PwaInstallationStats {
  totalInstallations: number;
  uniqueInstallers: number;
}

export interface SuperAdminDashboardResponse {
  totals: SuperAdminDashboardTotals;
  branches: SuperAdminBranchSummary[];
}
