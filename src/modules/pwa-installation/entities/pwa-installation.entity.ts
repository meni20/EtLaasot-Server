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
import type { PwaPlatform } from '../pwa-installation.constants';

@Table({
  tableName: 'pwa_installations',
  timestamps: false,
  underscored: true,
  indexes: [
    {
      name: 'pwa_installations_installation_id_key',
      unique: true,
      fields: ['installation_id'],
    },
    {
      name: 'pwa_installations_user_uuid_idx',
      fields: ['user_uuid'],
    },
  ],
})
export default class PwaInstallation extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID, allowNull: false })
  declare id: string;

  @Column({
    type: DataType.UUID,
    allowNull: false,
    unique: true,
    field: 'installation_id',
  })
  declare installationId: string;

  @ForeignKey(() => User)
  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'user_uuid',
    onDelete: 'RESTRICT',
    onUpdate: 'CASCADE',
  })
  declare userUuid: string;

  @Column({ type: DataType.STRING(32), allowNull: false })
  declare platform: PwaPlatform;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'installed_at' })
  declare installedAt: Date;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'last_seen_at' })
  declare lastSeenAt: Date;
}
