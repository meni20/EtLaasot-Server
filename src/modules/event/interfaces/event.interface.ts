export interface IEvent {
  id?: string;
  name: string;
  startDate: Date;
  endDate: Date;
  address: string;
  description: string;
  eventType?: string;
  branchId?: string;
  imagePath?: string | null;
  imageUrl?: string | null;
  aiSummary?: string | null;
  aiSummaryGeneratedAt?: Date | null;

  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}
