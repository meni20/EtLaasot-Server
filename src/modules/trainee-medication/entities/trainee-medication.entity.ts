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
import { ITraineeMedication } from '../interfaces/trainee-medication.interface';
import { MedicationFrequency } from '../trainee-medication.constants';

@Table({
  tableName: 'trainee_medications',
  timestamps: true,
  paranoid: true,
  underscored: true,
  indexes: [
    { name: 'idx_trainee_medications_trainee', fields: ['trainee_uuid'] },
    {
      name: 'idx_trainee_medications_active',
      fields: ['trainee_uuid', 'is_active'],
      where: { deleted_at: null },
    },
  ],
})
export default class TraineeMedication extends Model<ITraineeMedication> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => User)
  @Column({ field: 'trainee_uuid', type: DataType.UUID })
  declare traineeUuid: string;

  @Column({ field: 'medication_name', type: DataType.STRING(200) })
  declare medicationName: string;

  @AllowNull
  @Column(DataType.STRING(100))
  declare dosage: string | null;

  @AllowNull
  @Column(DataType.STRING(30))
  declare frequency: MedicationFrequency | null;

  @AllowNull
  @Column(DataType.STRING(300))
  declare schedule: string | null;

  @AllowNull
  @Column(DataType.TEXT)
  declare instructions: string | null;

  @AllowNull
  @Column(DataType.TEXT)
  declare notes: string | null;

  @Default(true)
  @Column({ field: 'is_active', type: DataType.BOOLEAN })
  declare isActive: boolean;

  @BelongsTo(() => User, 'traineeUuid')
  declare trainee: User;
}
