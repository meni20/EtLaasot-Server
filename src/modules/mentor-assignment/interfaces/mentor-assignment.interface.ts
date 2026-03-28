export interface IMentorAssignment {
  id?: string;
  mentorId: string;
  traineeId: string;
  branchId: string;
  startDate?: Date;
  endDate?: Date | null;
  isActive?: boolean;

  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}
