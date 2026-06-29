export type UserGender = 'male' | 'female';
export type ShirtSize = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | 'OTHER';

export interface IUser {
  id: string;
  nationalIdHash?: string;
  nationalIdLast4?: string | null;
  nationalIdMasked?: string | null;
  name: string;
  phoneNumber: string;
  gender?: UserGender | null;
  address?: string | null;
  email?: string | null;
  age?: number | null;
  dateOfBirth?: string | null;
  shirtSize?: ShirtSize | null;
  customShirtSize?: string | null;
  notes?: string | null;
  parentName?: string | null;
  branchId?: string | null;

  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}
