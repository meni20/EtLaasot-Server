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

  @ForeignKey(() => User)
  @Column(DataType.STRING)
  declare traineeId: string;

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
}
