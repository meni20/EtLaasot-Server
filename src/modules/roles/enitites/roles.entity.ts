import {
  Model,
  Table,
  Column,
  DataType,
  AllowNull,
  PrimaryKey,
  BelongsTo,
  BelongsToMany,
  Default,
} from 'sequelize-typescript';
import { IRole } from '../interfaces/roles.interface';
import User from 'src/modules/user/entities/user.entity';
import UserRole from 'src/modules/user-role/enitites/user-role.entity';

@Table({
  tableName: 'roles',
  timestamps: false,
  paranoid: false,
})
export default class Role extends Model<IRole> {
  @PrimaryKey
  @Column(DataType.STRING)
  declare id: number;

  @Column(DataType.STRING)
  name: string;

  @BelongsToMany(() => User, () => UserRole)
  users: User[];
}
