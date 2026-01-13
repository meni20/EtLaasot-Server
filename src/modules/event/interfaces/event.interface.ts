export interface IEvent {
  id?: number;
  name: string;
  startDate: Date;
  endDate: Date;
  address: string;
  description: string;

  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}
