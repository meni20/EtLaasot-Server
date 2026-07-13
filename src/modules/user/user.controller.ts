import UserService from './user.service';
import type { UserListStatus } from './user.service';
import { UserDto } from './dtos/user.dto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthorizationService } from '../auth/authorization.service';
import { UpdateCurrentUserProfileDto } from './dtos/current-user-profile.dto';
import { UpdateUserDto } from './dtos/update-user.dto';
import { ArchiveUserDto } from './dtos/archive-user.dto';

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
  public getAllVolunteers(
    @Query('branchId') branchId: string,
    @Query('status') status: string,
    @Req() req: any,
  ) {
    this.authorizationService.assertAdminForRequestedBranch(req.user, branchId);
    return this.userService.getAllVolunteers(
      branchId,
      true,
      this.parseListStatus(status),
    );
  }

  @Get('get-all-trainees')
  public getAllTrainees(
    @Query('branchId') branchId: string,
    @Query('status') status: string,
    @Req() req: any,
  ) {
    if (branchId) {
      this.authorizationService.assertBranchAccess(req.user, branchId);
    } else {
      this.authorizationService.assertSuperAdmin(req.user);
    }

    const includeNotes = branchId
      ? this.authorizationService.hasAdminAccess(req.user, branchId)
      : true;
    const includeNationalIdRevealId = branchId
      ? this.authorizationService.hasAdminAccess(req.user, branchId)
      : this.authorizationService.isSuperAdmin(req.user);

    return this.userService.getAllTrainees(
      branchId,
      includeNotes,
      includeNationalIdRevealId,
      this.parseListStatus(status),
    );
  }

  @Get('get-all')
  public getAll(
    @Query('branchId') branchId: string,
    @Query('status') status: string,
    @Req() req: any,
  ) {
    this.authorizationService.assertAdminForRequestedBranch(req.user, branchId);
    return this.userService.getAllUsers(
      branchId,
      true,
      this.parseListStatus(status),
    );
  }

  @Get(':userUuid/national-id')
  public async getNationalId(
    @Param('userUuid', new ParseUUIDPipe({ version: '4' })) userUuid: string,
    @Req() req: any,
  ) {
    await this.authorizationService.assertAdminForUserUuid(req.user, userUuid);
    return this.userService.getNationalIdByUuid(userUuid);
  }

  @Patch(':userId/password-reset')
  public async resetPassword(@Param('userId') userId: string, @Req() req: any) {
    await this.authorizationService.assertAdminForUser(req.user, userId);
    return this.userService.resetPassword(userId);
  }

  @Patch(':userId/archive')
  public async archiveUser(
    @Param('userId') userId: string,
    @Body() body: ArchiveUserDto,
    @Req() req: any,
  ) {
    await this.authorizationService.assertCanArchiveUser(req.user, userId);
    return this.userService.archiveUser(
      userId,
      this.authorizationService.getActorId(req.user) ?? '',
      body?.reason,
    );
  }

  @Patch(':userId/restore')
  public async restoreUser(@Param('userId') userId: string, @Req() req: any) {
    await this.authorizationService.assertCanArchiveUser(req.user, userId);
    return this.userService.restoreUser(userId);
  }

  @Patch(':userId')
  public async updateUser(
    @Param('userId') userId: string,
    @Body() userData: UpdateUserDto,
    @Req() req: any,
  ) {
    await this.authorizationService.assertAdminForUser(req.user, userId);
    return this.userService.updateUserDetails(userId, userData);
  }

  @Get(':userId')
  public async getUser(@Param('userId') userId: string, @Req() req: any) {
    await this.authorizationService.assertSelfOrAdminForUser(req.user, userId);
    const includeNotes =
      userId !== this.authorizationService.getActorId(req.user);
    return this.userService.findById(userId, includeNotes);
  }

  private parseListStatus(status?: string): UserListStatus {
    if (!status) {
      return 'active';
    }

    if (status === 'active' || status === 'archived' || status === 'all') {
      return status;
    }

    throw new BadRequestException('Invalid user list status');
  }
}
