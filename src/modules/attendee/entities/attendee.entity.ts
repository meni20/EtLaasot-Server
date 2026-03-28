import {
  Table,
  Model,
  Column,
  DataType,
  AllowNull,
  ForeignKey,
  BelongsTo,
  PrimaryKey,
  Default,
  Unique,
} from 'sequelize-typescript';
import User from 'src/modules/user/entities/user.entity';
import Event from 'src/modules/event/entities/event.entity';

@Table({
  tableName: 'attendee',
  paranoid: true,
  timestamps: true,
  indexes: [{ unique: true, fields: ['userId', 'eventId'] }],
})
export default class Attendee extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => Event)
  @Column(DataType.UUID)
  declare eventId: string;

  @ForeignKey(() => User)
  @Column(DataType.STRING)
  declare userId: string;

  @Column({ type: DataType.STRING(20), defaultValue: 'pending' })
  declare rsvpStatus: string; // pending | confirmed | declined

  @AllowNull
  @Column(DataType.DATE)
  declare rsvpDate: Date;

  @Column({ type: DataType.BOOLEAN, defaultValue: false })
  declare checkedIn: boolean;

  @AllowNull
  @Column(DataType.DATE)
  declare checkedInAt: Date;

  @AllowNull
  @ForeignKey(() => User)
  @Column({ field: 'checked_in_by', type: DataType.STRING })
  declare checkedInBy: string;

  @AllowNull
  @Column(DataType.TEXT)
  declare notes: string;

  @BelongsTo(() => Event)
  declare event: Event;

  @BelongsTo(() => User, 'userId')
  declare user: User;
}
