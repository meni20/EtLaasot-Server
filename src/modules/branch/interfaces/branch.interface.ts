export interface IBranch {
  id: string;
  name: string;
  city: string;
  address?: string;
  phone?: string;
  email?: string;
  isActive?: boolean;

  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}
