import type {
  ApplicationFormData,
  RegistrationType,
  SignaturePurpose,
} from './admission.policy';
import {
  Column,
  DataType,
  Default,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';

@Table({
  tableName: 'trainee_applications',
  underscored: true,
  timestamps: true,
})
export class TraineeApplication extends Model {
  @Default('TRAINEE')
  @Column(DataType.STRING(12))
  declare registrationType: RegistrationType;
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;
  @Column(DataType.STRING(64)) declare nationalIdHash: string;
  @Column(DataType.TEXT) declare nationalIdEncrypted: string;
  @Column(DataType.STRING(50)) declare branchId: string;
  @Column(DataType.STRING(24)) declare status: string;
  @Column(DataType.JSONB)
  declare draftData: ApplicationFormData<RegistrationType>;
  @Column(DataType.INTEGER) declare revision: number;
  @Column(DataType.SMALLINT) declare currentStep: number;
  @Column(DataType.STRING(2000)) declare feedbackReason: string | null;
  @Column(DataType.STRING(12)) declare documentStatus: string;
  @Column(DataType.UUID) declare provisionedUserId: string | null;
  @Column(DataType.UUID) declare approvedActivityYearId: string | null;
  @Column(DataType.UUID) declare reviewedBy: string | null;
  @Column(DataType.DATE) declare reviewedAt: Date | null;
}
@Table({ tableName: 'applicant_sessions', underscored: true, timestamps: true })
export class ApplicantSession extends Model {
  @PrimaryKey @Column(DataType.UUID) declare applicationId: string;
  @Column(DataType.STRING(64)) declare tokenHash: string;
  @Column(DataType.STRING(64)) declare recoveryHash: string;
  @Column(DataType.DATE) declare expiresAt: Date;
  @Column(DataType.DATE) declare recoveryExpiresAt: Date;
  @Column(DataType.DATE) declare revokedAt: Date | null;
}
@Table({
  tableName: 'trainee_application_versions',
  underscored: true,
  timestamps: true,
  updatedAt: false,
})
export class ApplicationVersion extends Model {
  @Default('TRAINEE')
  @Column(DataType.STRING(12))
  declare registrationType: RegistrationType;
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;
  @Column(DataType.UUID) declare applicationId: string;
  @Column(DataType.INTEGER) declare versionNumber: number;
  @Column(DataType.INTEGER) declare submittedRevision: number;
  @Column(DataType.UUID) declare idempotencyKey: string;
  @Column(DataType.JSONB)
  declare formData: ApplicationFormData<RegistrationType>;
  @Column(DataType.STRING(64)) declare contentHash: string;
  @Column(DataType.JSONB) declare declarations: string[];
  @Column(DataType.STRING(80)) declare declarationVersion: string;
  @Column(DataType.STRING(50)) declare templateVersion: string;
}
@Table({
  tableName: 'trainee_application_evidence',
  underscored: true,
  timestamps: true,
  updatedAt: false,
})
export class ApplicationEvidence extends Model {
  @Column(DataType.STRING(50)) declare templateVersion: string | null;
  @Column(DataType.STRING(64)) declare sourceChecksum: string | null;
  @Column(DataType.DATE) declare generatedAt: Date | null;
  @Default('TRAINEE')
  @Column(DataType.STRING(12))
  declare registrationType: RegistrationType;
  @Column(DataType.STRING(32))
  declare signaturePurpose: SignaturePurpose | null;
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;
  @Column(DataType.UUID) declare applicationId: string;
  @Column(DataType.UUID) declare versionId: string | null;
  @Column(DataType.STRING(24)) declare kind: string;
  @Column(DataType.STRING(100)) declare storageBucket: string;
  @Column(DataType.STRING(300)) declare storagePath: string;
  @Column(DataType.STRING(64)) declare mimeType: string;
  @Column(DataType.INTEGER) declare fileSize: number;
  @Column(DataType.STRING(64)) declare checksum: string;
  @Column(DataType.STRING(64)) declare contentHash: string;
  @Column(DataType.DATE) declare verifiedAt: Date;
}
@Table({
  tableName: 'trainee_application_events',
  underscored: true,
  timestamps: true,
  updatedAt: false,
})
export class ApplicationEvent extends Model {
  @Column(DataType.STRING(2000)) declare reason: string | null;
  @Column(DataType.UUID) declare versionId: string | null;
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  declare id: string;
  @Column(DataType.UUID) declare applicationId: string;
  @Column(DataType.UUID) declare actorUuid: string | null;
  @Column(DataType.STRING(32)) declare action: string;
}
export const ADMISSION_MODELS = [
  TraineeApplication,
  ApplicantSession,
  ApplicationVersion,
  ApplicationEvidence,
  ApplicationEvent,
];
