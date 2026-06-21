import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import BranchService from './branch.service';
import { CreateBranchDto, UpdateBranchDto } from './dtos/branch.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import { AuthorizationService } from '../auth/authorization.service';

@Controller('branch')
@UseGuards(JwtAuthGuard)
export default class BranchController {
  constructor(
    private readonly branchService: BranchService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  @Get('all')
  @Roles(AUTH_ROLES.SUPER_ADMIN.id)
  @UseGuards(RolesGuard)
  getAllBranches() {
    return this.branchService.getAllBranches();
  }

  @Get(':branchId/dashboard')
  getBranchDashboard(@Param('branchId') branchId: string, @Req() req: any) {
    this.authorizationService.assertAdminForBranch(req.user, branchId);
    return this.branchService.getBranchDashboard(branchId);
  }

  @Get(':branchId')
  getBranch(@Param('branchId') branchId: string, @Req() req: any) {
    this.authorizationService.assertBranchAccess(req.user, branchId);
    return this.branchService.getBranchById(branchId);
  }

  @Post('create')
  @Roles(AUTH_ROLES.SUPER_ADMIN.id)
  @UseGuards(RolesGuard)
  createBranch(@Body() dto: CreateBranchDto) {
    return this.branchService.createBranch(dto);
  }

  @Put(':branchId')
  @Roles(AUTH_ROLES.SUPER_ADMIN.id)
  @UseGuards(RolesGuard)
  updateBranch(
    @Param('branchId') branchId: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branchService.updateBranch(branchId, dto);
  }
}
