import {
  Model,
  Table,
  Column,
  DataType,
  PrimaryKey,
  HasMany,
} from 'sequelize-typescript';
import { IRole } from '../interfaces/roles.interface';
import UserRole from 'src/modules/user-role/enitites/user-role.entity';

@Table({
  tableName: 'roles',
  timestamps: false,
  paranoid: false,
})
export default class Role extends Model<IRole> {
  @PrimaryKey
  @Column(DataType.INTEGER)
  declare id: number;

  @Column(DataType.STRING)
  declare name: string;

  @HasMany(() => UserRole)
  declare userRoles: UserRole[];
}
