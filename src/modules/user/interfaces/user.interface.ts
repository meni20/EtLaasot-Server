export interface IUser {
  id: string;
  name: string;
  phoneNumber: string;
  address?: string | null;
  email?: string | null;
  age?: number | null;
  branchId?: string | null;

  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}
