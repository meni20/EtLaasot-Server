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
      name: 'idx_event_pairing_event_trainee_active',
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
  @Column(DataType.UUID)
  declare mentorId: string;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  declare traineeId: string;

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
    return { ...super.toJSON() };
  }
}
