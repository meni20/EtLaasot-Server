import {
  Table,
  Model,
  Column,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import User from 'src/modules/user/entities/user.entity';
import Event from 'src/modules/event/entities/event.entity';

@Table({
  tableName: 'attendee',
  paranoid: true,
  timestamps: true,
})
export default class Attendee extends Model {
  @ForeignKey(() => Event)
  @Column(DataType.UUID)
  eventId: string;

  @ForeignKey(() => User)
  @Column(DataType.STRING)
  userId: string;

  @BelongsTo(() => Event)
  event: Event;

  @BelongsTo(() => User)
  user: User;
}
