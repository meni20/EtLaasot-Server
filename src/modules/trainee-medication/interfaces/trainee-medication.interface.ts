import { MedicationFrequency } from '../trainee-medication.constants';

export interface ITraineeMedication {
  id?: string;
  traineeUuid: string;
  medicationName: string;
  dosage?: string | null;
  frequency?: MedicationFrequency | null;
  schedule?: string | null;
  instructions?: string | null;
  notes?: string | null;
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}
