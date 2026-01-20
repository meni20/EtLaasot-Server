export interface IAttendee {
  eventId: string;
  userId: string;

  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}
