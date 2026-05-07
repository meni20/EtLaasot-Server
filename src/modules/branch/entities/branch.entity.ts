import {
  Model,
  Table,
  Column,
  DataType,
  PrimaryKey,
  HasMany,
} from 'sequelize-typescript';
import User from 'src/modules/user/entities/user.entity';
import Event from 'src/modules/event/entities/event.entity';
import VolunteerActivity from 'src/modules/activity/entities/activity.entity';

@Table({
  tableName: 'branch',
  paranoid: true,
  timestamps: true,
})
export default class Branch extends Model {
  @PrimaryKey
  @Column(DataType.STRING(50))
  declare id: string;

  @Column(DataType.STRING(100))
  declare name: string;

  @Column(DataType.STRING(100))
  declare city: string;

  @Column(DataType.STRING(255))
  declare address: string;

  @Column(DataType.STRING(20))
  declare phone: string;

  @Column(DataType.STRING(100))
  declare email: string;

  @Column({ type: DataType.BOOLEAN, defaultValue: true })
  declare isActive: boolean;

  @HasMany(() => User)
  declare users: User[];

  @HasMany(() => Event)
  declare events: Event[];

  @HasMany(() => VolunteerActivity)
  declare activities: VolunteerActivity[];
}
