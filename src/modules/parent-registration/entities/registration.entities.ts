import User from '../../user/entities/user.entity';
import Branch from '../../branch/entities/branch.entity';
import {
  BelongsTo,
  ForeignKey,
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import type { RegistrationData } from '../registration.validation';

@Table({ tableName: 'activity_years', timestamps: true, underscored: true })
export class ActivityYear extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare name: string;

  @Column({ type: DataType.DATEONLY, allowNull: false })
  declare startsOn: string;

  @Column({ type: DataType.DATEONLY, allowNull: false })
  declare endsOn: string;

  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare isActive: boolean;
}

@Table({
  tableName: 'branch_registration_periods',
  timestamps: true,
  underscored: true,
})
export class BranchRegistrationPeriod extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => ActivityYear)
  @Column({ type: DataType.UUID, allowNull: false })
  declare activityYearId: string;

  @ForeignKey(() => Branch)
  @Column({ type: DataType.STRING(50), allowNull: false })
  declare branchId: string;

  @Column({ type: DataType.STRING(10), allowNull: false })
  declare status: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare openedBy: string;

  @Column({ type: DataType.DATE, allowNull: false })
  declare openedAt: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  declare closedAt: Date | null;

  @BelongsTo(() => ActivityYear, 'activityYearId')
  declare activityYear: ReturnType<() => ActivityYear>;

  @BelongsTo(() => Branch, 'branchId')
  declare branch: ReturnType<() => Branch>;

  @BelongsTo(() => User, 'openedBy')
  declare opener: ReturnType<() => User>;
}

@Table({ tableName: 'registration_forms', timestamps: true, underscored: true })
export class RegistrationForm extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare traineeUuid: string;

  @ForeignKey(() => Branch)
  @Column({ type: DataType.STRING(50), allowNull: false })
  declare branchId: string;

  @ForeignKey(() => ActivityYear)
  @Column({ type: DataType.UUID, allowNull: false })
  declare activityYearId: string;

  @Column({ type: DataType.STRING(12), allowNull: false })
  declare requestType: string;

  @Column({ type: DataType.STRING(24), allowNull: false })
  declare status: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare draftData: Partial<RegistrationData>;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare draftRevision: number;

  @Column({ type: DataType.SMALLINT, allowNull: false })
  declare currentStep: number;

  @Column({ type: DataType.BOOLEAN, allowNull: false })
  declare blocksAccess: boolean;

  @Column({ type: DataType.STRING(2000), allowNull: true })
  declare requestReason: string | null;

  @Column({ type: DataType.STRING(2000), allowNull: true })
  declare feedbackReason: string | null;

  @ForeignKey(() => RegistrationForm)
  @Column({ type: DataType.UUID, allowNull: true })
  declare previousApprovedFormId: string | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare submittedAt: Date | null;

  @Column({ type: DataType.DATE, allowNull: true })
  declare approvedAt: Date | null;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: true })
  declare approvedBy: string | null;

  @Column({ type: DataType.STRING(12), allowNull: false })
  declare documentStatus: string;

  @BelongsTo(() => User, 'traineeUuid')
  declare trainee: ReturnType<() => User>;

  @BelongsTo(() => Branch, 'branchId')
  declare branch: ReturnType<() => Branch>;

  @BelongsTo(() => ActivityYear, 'activityYearId')
  declare activityYear: ReturnType<() => ActivityYear>;

  @BelongsTo(() => RegistrationForm, 'previousApprovedFormId')
  declare previousApprovedForm: ReturnType<() => RegistrationForm>;

  @BelongsTo(() => User, 'approvedBy')
  declare approver: ReturnType<() => User>;
}

@Table({
  tableName: 'registration_form_versions',
  timestamps: true,
  underscored: true,
  createdAt: false,
  updatedAt: false,
})
export class RegistrationFormVersion extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => RegistrationForm)
  @Column({ type: DataType.UUID, allowNull: false })
  declare formId: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare versionNumber: number;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare formData: RegistrationData;

  @Column({ type: DataType.STRING(50), allowNull: false })
  declare templateVersion: string;

  @Column({ type: DataType.STRING(80), allowNull: false })
  declare declarationVersion: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare declarations: string[];

  @Column({ type: DataType.JSONB, allowNull: false })
  declare signingMetadata: Record<string, unknown>;

  @Column({ type: DataType.UUID, allowNull: false })
  declare idempotencyKey: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare submittedRevision: number;

  @Column({ type: DataType.DATE, allowNull: false })
  declare submittedAt: Date;

  @BelongsTo(() => RegistrationForm, 'formId')
  declare form: ReturnType<() => RegistrationForm>;
}

@Table({
  tableName: 'registration_form_documents',
  timestamps: true,
  underscored: true,
})
export class RegistrationFormDocument extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => RegistrationForm)
  @Column({ type: DataType.UUID, allowNull: false })
  declare formId: string;

  @ForeignKey(() => RegistrationFormVersion)
  @Column({ type: DataType.UUID, allowNull: true })
  declare versionId: string | null;

  @Column({ type: DataType.STRING(24), allowNull: false })
  declare kind: string;

  @Column({ type: DataType.STRING(100), allowNull: false })
  declare storageBucket: string;

  @Column({ type: DataType.STRING(300), allowNull: false })
  declare storagePath: string;

  @Column({ type: DataType.STRING(64), allowNull: false })
  declare mimeType: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare fileSize: number;

  @Column({ type: DataType.STRING(64), allowNull: false })
  declare checksum: string;

  @Column({ type: DataType.DATE, allowNull: false })
  declare verifiedAt: Date;

  @BelongsTo(() => RegistrationForm, 'formId')
  declare form: ReturnType<() => RegistrationForm>;

  @BelongsTo(() => RegistrationFormVersion, 'versionId')
  declare version: ReturnType<() => RegistrationFormVersion>;
}

@Table({
  tableName: 'registration_form_history',
  timestamps: true,
  underscored: true,
  updatedAt: false,
})
export class RegistrationFormHistory extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;

  @ForeignKey(() => RegistrationForm)
  @Column({ type: DataType.UUID, allowNull: true })
  declare formId: string | null;

  @ForeignKey(() => RegistrationFormVersion)
  @Column({ type: DataType.UUID, allowNull: true })
  declare versionId: string | null;

  @ForeignKey(() => BranchRegistrationPeriod)
  @Column({ type: DataType.UUID, allowNull: true })
  declare periodId: string | null;

  @ForeignKey(() => User)
  @Column({ type: DataType.UUID, allowNull: false })
  declare actorUuid: string;

  @Column({ type: DataType.STRING(40), allowNull: false })
  declare action: string;

  @Column({ type: DataType.JSONB, allowNull: false })
  declare metadata: Record<string, unknown>;

  @BelongsTo(() => RegistrationForm, 'formId')
  declare form: ReturnType<() => RegistrationForm>;

  @BelongsTo(() => RegistrationFormVersion, 'versionId')
  declare version: ReturnType<() => RegistrationFormVersion>;

  @BelongsTo(() => BranchRegistrationPeriod, 'periodId')
  declare period: ReturnType<() => BranchRegistrationPeriod>;

  @BelongsTo(() => User, 'actorUuid')
  declare actor: ReturnType<() => User>;
}

export const REGISTRATION_MODELS = [
  ActivityYear,
  BranchRegistrationPeriod,
  RegistrationForm,
  RegistrationFormVersion,
  RegistrationFormDocument,
  RegistrationFormHistory,
];
