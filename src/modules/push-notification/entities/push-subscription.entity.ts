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

@Table({
  tableName: 'push_subscriptions',
  timestamps: false,
  underscored: true,
  indexes: [
    {
      name: 'push_subscriptions_endpoint_key',
      unique: true,
      fields: ['endpoint'],
    },
    {
      name: 'push_subscriptions_user_uuid_idx',
      fields: ['user_uuid'],
    },
  ],
})
export default class PushSubscriptionEntity extends Model {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column({ type: DataType.UUID, allowNull: false })
  declare id: string;

  @ForeignKey(() => User)
  @Column({
    type: DataType.UUID,
    allowNull: false,
    field: 'user_uuid',
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
  })
  declare userUuid: string;

  @Column({ type: DataType.TEXT, allowNull: false, unique: true })
  declare endpoint: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare p256dh: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare auth: string;

  @Column({
    type: DataType.DATE,
    allowNull: true,
    field: 'expiration_time',
  })
  declare expirationTime: Date | null;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'created_at' })
  declare createdAt: Date;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'updated_at' })
  declare updatedAt: Date;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false, field: 'last_seen_at' })
  declare lastSeenAt: Date;
}
