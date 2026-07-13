export type UserGender = 'male' | 'female';
export type ShirtSize = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | 'OTHER';

export interface IUser {
  id: string;
  nationalIdHash?: string;
  nationalIdLast4?: string | null;
  nationalIdEncrypted?: string | null;
  nationalIdRevealId?: string | null;
  nationalIdMasked?: string | null;
  passwordHash?: string | null;
  passwordChangedAt?: Date | null;
  mustChangePassword?: boolean;
  failedLoginAttempts?: number;
  lockedUntil?: Date | null;
  temporaryPasswordExpiresAt?: Date | null;
  isActive?: boolean;
  archivedAt?: Date | null;
  archivedBy?: string | null;
  archiveReason?: string | null;
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
