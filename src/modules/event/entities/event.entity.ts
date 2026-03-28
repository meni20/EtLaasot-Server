import {
  Model,
  Table,
  Column,
  HasMany,
  DataType,
  PrimaryKey,
  Default,
  AllowNull,
  ForeignKey,
  BelongsTo,
  BelongsToMany,
} from 'sequelize-typescript';
import { IEvent } from '../interfaces/event.interface';
import User from 'src/modules/user/entities/user.entity';
import Attendee from 'src/modules/attendee/entities/attendee.entity';
import Branch from 'src/modules/branch/entities/branch.entity';

@Table({ tableName: 'event', paranoid: true, timestamps: true })
export default class Event extends Model<IEvent> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({
    type: DataType.UUID,
  })
  declare id: string;

  @Column(DataType.STRING)
  declare name: string;

  @Column(DataType.STRING)
  declare description: string;

  @Column({ field: 'start_date', type: DataType.DATE })
  declare startDate: Date;

  @Column({ field: 'end_date', type: DataType.DATE })
  declare endDate: Date;

  @Column(DataType.STRING)
  declare address: string;

  @Column({ type: DataType.STRING(30), defaultValue: 'general' })
  declare eventType: string;

  @ForeignKey(() => Branch)
  @AllowNull
  @Column(DataType.STRING(50))
  declare branchId: string;

  @BelongsTo(() => Branch)
  declare branch: Branch;

  @HasMany(() => Attendee)
  declare attendees: Attendee[];

  @BelongsToMany(() => User, () => Attendee)
  declare users: User[];
}
