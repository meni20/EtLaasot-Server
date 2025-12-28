import {
  Model,
  Table,
  Column,
  DataType,
  AllowNull,
  PrimaryKey,
} from 'sequelize-typescript';
import { IUser } from '../interfaces/user.interface';

@Table({
  tableName: 'user',
  paranoid: true,
  timestamps: true,
})
export default class User extends Model<IUser> {
  @PrimaryKey
  @Column(DataType.STRING)
  declare id: string;

  @Column(DataType.STRING)
  name: string;

  @Column(DataType.STRING)
  phoneNumber: string;

  @AllowNull
  @Column(DataType.STRING)
  address: string;

  @AllowNull
  @Column(DataType.STRING)
  email: string;

  @AllowNull
  @Column(DataType.INTEGER)
  age: number;
}
