import {
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import User from '../../user/entities/user.entity';
import { DocumentType, MAX_DOCUMENT_SIZE } from '../trainee-document.constants';

@Table({
  tableName: 'trainee_documents',
  timestamps: true,
  underscored: true,
  indexes: [
    {
      name: 'trainee_documents_trainee_type_key',
      unique: true,
      fields: ['trainee_uuid', 'document_type'],
    },
    {
      name: 'trainee_documents_storage_path_key',
      unique: true,
      fields: ['storage_path'],
    },
  ],
})
export default class TraineeDocument extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID, allowNull: false })
  declare id: string;

  @ForeignKey(() => User)
  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'trainee_uuid',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  declare traineeUuid: string;

  @Column({
    type: DataType.STRING(32),
    allowNull: false,
    field: 'document_type',
    validate: { isIn: [Object.values(DocumentType)] },
  })
  declare documentType: DocumentType;

  @Column({
    type: DataType.STRING(200),
    allowNull: false,
    field: 'storage_path',
  })
  declare storagePath: string;

  @Column({
    type: DataType.STRING(255),
    allowNull: false,
    field: 'original_filename',
  })
  declare originalFilename: string;

  @Column({ type: DataType.STRING(64), allowNull: false, field: 'mime_type' })
  declare mimeType: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    field: 'file_size',
    validate: { min: 1, max: MAX_DOCUMENT_SIZE },
  })
  declare fileSize: number;
}
