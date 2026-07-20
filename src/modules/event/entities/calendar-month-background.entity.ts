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
import Branch from 'src/modules/branch/entities/branch.entity';
import User from 'src/modules/user/entities/user.entity';

@Table({
  tableName: 'calendar_month_background',
  paranoid: false,
  timestamps: true,
  indexes: [
    {
      name: 'calendar_month_background_branch_month_unique',
      unique: true,
      fields: ['branchId', 'monthKey'],
    },
  ],
})
export default class CalendarMonthBackground extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => Branch)
  @Column(DataType.STRING(50))
  declare branchId: string;

  @Column({ type: DataType.STRING(7), field: 'month_key' })
  declare monthKey: string;

  @Column({ field: 'image_path', type: DataType.TEXT })
  declare imagePath: string;

  @AllowNull
  @ForeignKey(() => User)
  @Column({ field: 'uploaded_by', type: DataType.UUID })
  declare uploadedBy: string | null;

  @BelongsTo(() => Branch)
  declare branch: Branch;

  @BelongsTo(() => User, 'uploadedBy')
  declare uploader: User;

  toJSON() {
    return { ...super.toJSON() };
  }
}
