import {
  Model,
  Table,
  Column,
  DataType,
  PrimaryKey,
  Default,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import User from 'src/modules/user/entities/user.entity';
import Branch from 'src/modules/branch/entities/branch.entity';

@Table({
  tableName: 'mentor_assignment',
  paranoid: true,
  timestamps: true,
  indexes: [
    {
      name: 'mentor_assignment_active_trainee_unique',
      unique: true,
      fields: ['branchId', 'traineeId'],
      where: { isActive: true, deletedAt: null },
    },
  ],
})
export default class MentorAssignment extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

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

  @Column({ type: DataType.DATEONLY, defaultValue: DataType.NOW })
  declare startDate: Date;

  @Column({ type: DataType.DATEONLY, allowNull: true })
  declare endDate: Date | null;

  @Column({ type: DataType.BOOLEAN, defaultValue: true })
  declare isActive: boolean;

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
