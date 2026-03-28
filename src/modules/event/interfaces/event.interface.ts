export interface IEvent {
  id?: string;
  name: string;
  startDate: Date;
  endDate: Date;
  address: string;
  description: string;
  eventType?: string;
  branchId?: string;

  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}
