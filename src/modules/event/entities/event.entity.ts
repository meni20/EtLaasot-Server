import {
  Model,
  Table,
  Column,
  HasMany,
  DataType,
  PrimaryKey,
  AutoIncrement,
  Default,
  BelongsToMany,
} from 'sequelize-typescript';
import { IEvent } from '../interfaces/event.interface';
import User from 'src/modules/user/entities/user.entity';
import Attendee from 'src/modules/attendee/entities/attendee.entity';

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

  @HasMany(() => Attendee)
  declare attendees: Attendee[];

  @BelongsToMany(() => User, () => Attendee)
  users: User[];
}
