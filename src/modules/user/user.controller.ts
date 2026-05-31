import UserService from './user.service';
import { UserDto } from './dtos/user.dto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthorizationService } from '../auth/authorization.service';
import { UpdateCurrentUserProfileDto } from './dtos/current-user-profile.dto';

@Controller('user')
@UseGuards(JwtAuthGuard)
export default class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  @Get('me')
  public getMe(@Req() req: any) {
    return this.userService.getCurrentUserProfile(req.user.userId);
  }

  @Patch('me')
  public updateMe(
    @Body() userData: UpdateCurrentUserProfileDto,
    @Req() req: any,
  ) {
    const allowedFields = ['email', 'phoneNumber', 'address'];
    const unknownFields = Object.keys(userData ?? {}).filter(
      (field) => !allowedFields.includes(field),
    );

    if (unknownFields.length > 0) {
      throw new BadRequestException(
        'Only email, phoneNumber and address can be updated',
      );
    }

    if (Object.keys(userData ?? {}).length === 0) {
      throw new BadRequestException('At least one profile field is required');
    }

    if (
      Object.prototype.hasOwnProperty.call(userData ?? {}, 'phoneNumber') &&
      !userData.phoneNumber?.trim()
    ) {
      throw new BadRequestException('phoneNumber is required');
    }

    return this.userService.updateCurrentUserProfile(req.user.userId, userData);
  }

  @Post('create-volunteer')
  public create(@Body() userData: UserDto, @Req() req: any) {
    this.authorizationService.assertAdminForBranch(
      req.user,
      userData.branchId ?? '',
    );
    return this.userService.createUserWithRole(userData);
  }

  @Post('create-trainee')
  public createTrainee(@Body() userData: UserDto, @Req() req: any) {
    this.authorizationService.assertAdminForBranch(
      req.user,
      userData.branchId ?? '',
    );
    return this.userService.createTraineeWithRole(userData);
  }

  @Get('get-all-volunteers')
  public getAllVolunteers(@Query('branchId') branchId: string, @Req() req: any) {
    this.authorizationService.assertAdminForRequestedBranch(req.user, branchId);
    return this.userService.getAllVolunteers(branchId);
  }

  @Get('get-all-trainees')
  public getAllTrainees(@Query('branchId') branchId: string, @Req() req: any) {
    if (branchId) {
      this.authorizationService.assertBranchAccess(req.user, branchId);
    } else {
      this.authorizationService.assertSuperAdmin(req.user);
    }

    return this.userService.getAllTrainees(branchId);
  }

  @Get('get-all')
  public getAll(@Query('branchId') branchId: string, @Req() req: any) {
    this.authorizationService.assertAdminForRequestedBranch(req.user, branchId);
    return this.userService.getAllUsers(branchId);
  }

  @Get(':userId')
  public async getUser(@Param('userId') userId: string, @Req() req: any) {
    await this.authorizationService.assertSelfOrAdminForUser(req.user, userId);
    return this.userService.findById(userId);
  }
}
