export type UserGender = 'male' | 'female';

export interface IUser {
  id: string;
  name: string;
  phoneNumber: string;
  gender?: UserGender | null;
  address?: string | null;
  email?: string | null;
  age?: number | null;
  branchId?: string | null;

  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}
