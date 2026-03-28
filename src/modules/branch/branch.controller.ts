import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import BranchService from './branch.service';
import { CreateBranchDto, UpdateBranchDto } from './dtos/branch.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('branch')
@UseGuards(JwtAuthGuard)
export default class BranchController {
  constructor(private readonly branchService: BranchService) {}

  @Get('all')
  getAllBranches() {
    return this.branchService.getAllBranches();
  }

  @Get(':branchId/dashboard')
  getBranchDashboard(@Param('branchId') branchId: string) {
    return this.branchService.getBranchDashboard(branchId);
  }

  @Get(':branchId')
  getBranch(@Param('branchId') branchId: string) {
    return this.branchService.getBranchById(branchId);
  }

  @Post('create')
  createBranch(@Body() dto: CreateBranchDto) {
    return this.branchService.createBranch(dto);
  }

  @Put(':branchId')
  updateBranch(
    @Param('branchId') branchId: string,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branchService.updateBranch(branchId, dto);
  }
}
