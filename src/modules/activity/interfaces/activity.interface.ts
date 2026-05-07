import { VolunteerActivityStatus } from '../activity.constants';

export interface IVolunteerActivity {
  id?: string;
  volunteerId: string;
  traineeId: string;
  eventId: string;
  branchId?: string | null;
  startTime: Date;
  endTime?: Date | null;
  status: VolunteerActivityStatus;
  notes?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

