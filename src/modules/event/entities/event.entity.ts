import {
  Model,
  Table,
  Column,
  HasMany,
  DataType,
  PrimaryKey,
} from 'sequelize-typescript';
import { IEvent } from '../interfaces/event.interface';
import User from 'src/modules/user/entities/user.entity';
import Attendee from 'src/modules/attendee/entities/attendee.entity';

@Table({
  tableName: 'event',
  paranoid: true,
  timestamps: true,
})
export default class Event extends Model<IEvent> {
  @PrimaryKey
  @Column(DataType.UUID)
  declare id: string;

  @Column(DataType.STRING)
  name: string;

  @Column(DataType.STRING)
  description: string;

  @Column({ field: 'start_date', type: DataType.DATE })
  startDate: Date;

  @Column({ field: 'end_date', type: DataType.DATE })
  endDate: Date;

  @Column(DataType.STRING)
  address: string;

  @HasMany(() => Attendee)
  attendees: User[];
}
