import UserService from './user.service';
import { UserDto } from './dtos/user.dto';
import { Body, Controller, Get, Post } from '@nestjs/common';

@Controller('user')
export default class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('create')
  public create(@Body() userData: UserDto) {
    return this.userService.createUserWithRole(userData);
  }

  @Get('get-all-users')
  public getAllUsers() {
    return this.userService.getAllVolunteers();
  }

  @Get('get-all-volunteers')
  public getAllVolunteers() {
    return this.userService.getAllVolunteers();
  }
}
