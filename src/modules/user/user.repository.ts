import User from './entities/user.entity';
import { Injectable } from '@nestjs/common';
import { IUser } from './interfaces/user.interface';

@Injectable()
export default class UserRepository {
  public async create(userData: IUser) {
    return await User.create(userData);
  }

  public async getAllUsers() {
    return await User.findAll();
  }
}
