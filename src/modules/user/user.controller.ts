import UserService from './user.service';
import { UserDto } from './dtos/user.dto';
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('user')
@UseGuards(JwtAuthGuard)
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
  public getAllVolunteers(@Query('branchId') branchId?: string) {
    return this.userService.getAllVolunteers(branchId);
  }

  @Get('get-all-trainees')
  public getAllTrainees(@Query('branchId') branchId?: string) {
    return this.userService.getAllTrainees(branchId);
  }

  @Get('get-all')
  public getAll(@Query('branchId') branchId?: string) {
    return this.userService.getAllUsers(branchId);
  }

  @Get(':userId')
  public getUser(@Param('userId') userId: string) {
    return this.userService.findById(userId);
  }
}
