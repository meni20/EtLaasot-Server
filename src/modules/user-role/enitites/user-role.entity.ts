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

  @PrimaryKey
  @Column(DataType.INTEGER)
  declare roleId: number;

  @Column(DataType.STRING)
  grantedBy: string;

  @AllowNull
  @Column(DataType.DATE)
  expirationDate: Date;

  @BelongsTo(() => User)
  user: User;
}
