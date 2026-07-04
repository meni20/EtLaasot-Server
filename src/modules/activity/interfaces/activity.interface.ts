import { VolunteerActivityStatus } from '../activity.constants';

export interface IVolunteerActivity {
  id?: string;
  volunteerId: string;
  volunteerUuid?: string | null;
  traineeId: string;
  traineeUuid?: string | null;
  eventId: string;
  branchId?: string | null;
  startTime: Date;
  endTime?: Date | null;
  status: VolunteerActivityStatus;
  notes?: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}
