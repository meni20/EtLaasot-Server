import UserService from './user.service';
import { UserDto } from './dtos/user.dto';
import { Body, Controller, Get, Post } from '@nestjs/common';

@Controller('user')
export default class UserController {
  constructor(private readonly UserService: UserService) {}

  @Post('create')
  public create(@Body() userData: UserDto) {
    return this.UserService.create(userData);
  }

  @Get('get-all-users')
  public getAllUsers() {
    return this.UserService.getAllUsers();
  }
}
