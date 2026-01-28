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
  declare name: string;

  @Column({ field: 'phone_number', type: DataType.STRING })
  declare phoneNumber: string;

  @AllowNull
  @Column(DataType.STRING)
  declare address: string;

  @AllowNull
  @Column(DataType.STRING)
  declare email: string;

  @AllowNull
  @Column(DataType.INTEGER)
  declare age: number;

  @HasMany(() => UserRole)
  declare userRoles: UserRole[];

  @HasMany(() => Attendee)
  declare attendees: Attendee[];
}
