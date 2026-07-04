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
} from 'sequelize-typescript';
import User from 'src/modules/user/entities/user.entity';
import Event from 'src/modules/event/entities/event.entity';
import { AttendeeRsvpStatus } from '../attendee.constants';

@Table({
  tableName: 'attendee',
  paranoid: true,
  timestamps: true,
  indexes: [
    {
      name: 'attendee_event_user_active_unique',
      unique: true,
      fields: ['eventId', 'userId'],
      where: { deletedAt: null },
    },
  ],
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

  @AllowNull
  @Column({ field: 'user_uuid', type: DataType.UUID })
  declare userUuid: string | null;

  @Column({
    type: DataType.ENUM(...Object.values(AttendeeRsvpStatus)),
    defaultValue: AttendeeRsvpStatus.PENDING,
  })
  declare rsvpStatus: AttendeeRsvpStatus;

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
  @Column({ field: 'checked_in_by_uuid', type: DataType.UUID })
  declare checkedInByUuid: string | null;

  @AllowNull
  @Column(DataType.TEXT)
  declare notes: string;

  @BelongsTo(() => Event)
  declare event: Event;

  @BelongsTo(() => User, 'userId')
  declare user: User;

  toJSON() {
    const values = { ...super.toJSON() } as Record<string, unknown>;
    const safeUserId = this.getDataValue('userUuid') as
      | string
      | null
      | undefined;
    const safeCheckedInBy = this.getDataValue('checkedInByUuid') as
      | string
      | null
      | undefined;

    if (safeUserId) {
      values.userId = safeUserId;
    } else {
      delete values.userId;
    }

    if (safeCheckedInBy) {
      values.checkedInBy = safeCheckedInBy;
    } else {
      delete values.checkedInBy;
    }

    delete values.userUuid;
    delete values.checkedInByUuid;

    return values;
  }
}
