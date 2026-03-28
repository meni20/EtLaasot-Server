import {
  Model,
  Table,
  Column,
  HasMany,
  DataType,
  AllowNull,
  PrimaryKey,
  ForeignKey,
  BelongsTo,
  BelongsToMany,
} from 'sequelize-typescript';
import { IUser } from '../interfaces/user.interface';
import Event from 'src/modules/event/entities/event.entity';
import Attendee from 'src/modules/attendee/entities/attendee.entity';
import UserRole from 'src/modules/user-role/enitites/user-role.entity';
import Branch from 'src/modules/branch/entities/branch.entity';

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

  @ForeignKey(() => Branch)
  @AllowNull
  @Column(DataType.STRING(50))
  declare branchId: string;

  @BelongsTo(() => Branch)
  declare branch: Branch;

  @HasMany(() => UserRole)
  declare userRoles: UserRole[];

  @HasMany(() => Attendee)
  declare attendees: Attendee[];

  @BelongsToMany(() => Event, () => Attendee)
  declare events: Event[];
}
