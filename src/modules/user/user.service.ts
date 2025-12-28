import UserRepository from './user.repository';
import { IUser } from './interfaces/user.interface';
import { Injectable, InternalServerErrorException } from '@nestjs/common';

@Injectable()
export default class UserService {
  constructor(private readonly UserRepository: UserRepository) {}

  public create(userData: IUser) {
    try {
      return this.UserRepository.create(userData);
    } catch (err) {
      throw new InternalServerErrorException(err);
    }
  }

  public getAllUsers() {
    try {
      return this.UserRepository.getAllUsers();
    } catch (err) {
      throw new InternalServerErrorException(err);
    }
  }
}
