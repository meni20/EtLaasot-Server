import UserService from './user.service';
import { UserDto } from './dtos/user.dto';
import { Body, Controller, Get, Post } from '@nestjs/common';

@Controller('user')
export default class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('create-volunteer')
  public create(@Body() userData: UserDto) {
    return this.userService.createUserWithRole(userData);
  }

  @Post('create-trainee')
  public createTrainee(@Body() userData: UserDto) {
    return this.userService.createTraineeWithRole(userData);
  }

  @Get('get-all-volunteers')
  public getAllUsers() {
    return this.userService.getAllVolunteers();
  }

  @Get('get-all-trainees')
  public getAllTrainees() {
    return this.userService.getAllTrainees();
  }

  @Get('get-all')
  public getAll() {
    return this.userService.getAllUsers();
  }
}
