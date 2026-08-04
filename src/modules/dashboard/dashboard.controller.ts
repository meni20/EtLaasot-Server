import { Controller, Get, UseGuards } from '@nestjs/common';
import { AUTH_ROLES } from 'src/constants/auth.constants';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import DashboardService from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AUTH_ROLES.SUPER_ADMIN.id)
export default class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('super-admin')
  public getSuperAdminDashboard() {
    return this.dashboardService.getSuperAdminDashboard();
  }
}
