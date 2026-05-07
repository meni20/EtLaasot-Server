import {
  AllowNull,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import User from 'src/modules/user/entities/user.entity';
import Event from 'src/modules/event/entities/event.entity';
import Branch from 'src/modules/branch/entities/branch.entity';
import { IVolunteerActivity } from '../interfaces/activity.interface';
import { VolunteerActivityStatus } from '../activity.constants';

@Table({
  tableName: 'volunteer_activity',
  paranoid: true,
  timestamps: true,
  indexes: [
    {
      name: 'idx_volunteer_activity_volunteer_status',
      fields: ['volunteer_id', 'status'],
    },
    {
      name: 'idx_volunteer_activity_branch_start',
      fields: ['branch_id', 'start_time'],
    },
    {
      unique: true,
      name: 'uq_volunteer_activity_active_volunteer',
      fields: ['volunteer_id'],
      where: { status: VolunteerActivityStatus.ACTIVE },
    },
  ],
})
export default class VolunteerActivity extends Model<IVolunteerActivity> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => User)
  @Column({ field: 'volunteer_id', type: DataType.STRING })
  declare volunteerId: string;

  @ForeignKey(() => User)
  @Column({ field: 'trainee_id', type: DataType.STRING })
  declare traineeId: string;

  @ForeignKey(() => Event)
  @Column({ field: 'event_id', type: DataType.UUID })
  declare eventId: string;

  @ForeignKey(() => Branch)
  @AllowNull
  @Column({ field: 'branch_id', type: DataType.STRING(50) })
  declare branchId: string | null;

  @Column({ field: 'start_time', type: DataType.DATE })
  declare startTime: Date;

  @AllowNull
  @Column({ field: 'end_time', type: DataType.DATE })
  declare endTime: Date | null;

  @Column({
    type: DataType.STRING(20),
    defaultValue: VolunteerActivityStatus.ACTIVE,
  })
  declare status: VolunteerActivityStatus;

  @AllowNull
  @Column(DataType.TEXT)
  declare notes: string | null;

  @BelongsTo(() => User, 'volunteerId')
  declare volunteer: User;

  @BelongsTo(() => User, 'traineeId')
  declare trainee: User;

  @BelongsTo(() => Event)
  declare event: Event;

  @BelongsTo(() => Branch)
  declare branch: Branch;
}

