export interface IUserRole {
  userId: string;
  roleId: string;
  grantedBy: string;
  expirationDate?: Date;

  // Timestamps
  createdAt?: Date;
  deletedAt?: Date;
}
