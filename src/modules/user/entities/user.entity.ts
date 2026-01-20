import {
  Model,
  Table,
  Column,
  HasMany,
  DataType,
  AllowNull,
  PrimaryKey,
} from 'sequelize-typescript';
import { IUser } from '../interfaces/user.interface';
import Attendee from 'src/modules/attendee/entities/attendee.entity';
import UserRole from 'src/modules/user-role/enitites/user-role.entity';

@Table({
  tableName: 'user',
  paranoid: true,
  timestamps: true,
})
export default class User extends Model<IUser> {
  @PrimaryKey
  @Column(DataType.STRING)
  declare id: string;

  @Column(DataType.STRING)
  name: string;

  @Column({ field: 'phone_number', type: DataType.STRING })
  phoneNumber: string;

  @AllowNull
  @Column(DataType.STRING)
  address: string;

  @AllowNull
  @Column(DataType.STRING)
  email: string;

  @AllowNull
  @Column(DataType.INTEGER)
  age: number;

  @HasMany(() => UserRole)
  userRoles: UserRole[];

  @HasMany(() => Attendee)
  attendees: Attendee[];
}
