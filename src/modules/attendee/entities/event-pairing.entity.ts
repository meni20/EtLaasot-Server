import {
  Table,
  Model,
  Column,
  DataType,
  ForeignKey,
  BelongsTo,
  PrimaryKey,
  Default,
} from 'sequelize-typescript';
import User from 'src/modules/user/entities/user.entity';
import Event from 'src/modules/event/entities/event.entity';
import Branch from 'src/modules/branch/entities/branch.entity';

@Table({
  tableName: 'event_pairing',
  paranoid: true,
  timestamps: true,
  indexes: [
    {
      name: 'event_pairing_mentor_active_unique',
      unique: true,
      fields: ['eventId', 'mentorId'],
      where: { deletedAt: null },
    },
    {
      name: 'event_pairing_trainee_active_unique',
      unique: true,
      fields: ['eventId', 'traineeId'],
      where: { deletedAt: null },
    },
  ],
})
export default class EventPairing extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => Event)
  @Column(DataType.UUID)
  declare eventId: string;

  @ForeignKey(() => User)
  @Column(DataType.STRING)
  declare mentorId: string;

  @Column({ field: 'mentor_uuid', type: DataType.UUID, allowNull: true })
  declare mentorUuid: string | null;

  @ForeignKey(() => User)
  @Column(DataType.STRING)
  declare traineeId: string;

  @Column({ field: 'trainee_uuid', type: DataType.UUID, allowNull: true })
  declare traineeUuid: string | null;

  @ForeignKey(() => Branch)
  @Column(DataType.STRING(50))
  declare branchId: string;

  @BelongsTo(() => Event)
  declare event: Event;

  @BelongsTo(() => User, 'mentorId')
  declare mentor: User;

  @BelongsTo(() => User, 'traineeId')
  declare trainee: User;

  @BelongsTo(() => Branch)
  declare branch: Branch;

  toJSON() {
    const values = { ...super.toJSON() } as Record<string, unknown>;
    const safeMentorId = this.getDataValue('mentorUuid') as
      | string
      | null
      | undefined;
    const safeTraineeId = this.getDataValue('traineeUuid') as
      | string
      | null
      | undefined;

    if (safeMentorId) {
      values.mentorId = safeMentorId;
    } else {
      delete values.mentorId;
    }

    if (safeTraineeId) {
      values.traineeId = safeTraineeId;
    } else {
      delete values.traineeId;
    }

    delete values.mentorUuid;
    delete values.traineeUuid;

    return values;
  }
}
