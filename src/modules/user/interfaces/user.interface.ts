export interface IUser {
  id: string;
  name: string;
  phoneNumber: string;
  address: string;
  email: string;
  age: number;

  // Timestamps
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}
