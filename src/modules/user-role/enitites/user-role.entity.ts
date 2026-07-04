import {
  Model,
  Table,
  Column,
  DataType,
  AllowNull,
  PrimaryKey,
  BelongsTo,
  ForeignKey,
} from 'sequelize-typescript';
import User from 'src/modules/user/entities/user.entity';
import Role from 'src/modules/roles/enitites/roles.entity';

@Table({
  tableName: 'user_roles',
  paranoid: true,
  timestamps: true,
})
export default class UserRole extends Model {
  @PrimaryKey
  @ForeignKey(() => User)
  @Column(DataType.STRING)
  declare userId: string;

  @AllowNull
  @Column({ field: 'user_uuid', type: DataType.UUID })
  declare userUuid: string | null;

  @PrimaryKey
  @ForeignKey(() => Role)
  @Column(DataType.INTEGER)
  declare roleId: number;

  @PrimaryKey
  @Column(DataType.STRING(50))
  declare resourceId: string;

  @Column(DataType.STRING)
  declare grantedBy: string;

  @AllowNull
  @Column(DataType.DATE)
  declare expirationDate: Date;

  @BelongsTo(() => User)
  declare user: User;

  toJSON() {
    const values = { ...super.toJSON() } as Record<string, unknown>;
    const safeUserId = this.getDataValue('userUuid') as
      | string
      | null
      | undefined;

    if (safeUserId) {
      values.userId = safeUserId;
    } else {
      delete values.userId;
    }

    delete values.userUuid;

    return values;
  }
}
