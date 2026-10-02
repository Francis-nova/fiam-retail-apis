import { Controller, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { StaffRole } from '../staff/entities/staff-user.entity';
import { DashboardService } from './dashboard.service';

@ApiBearerAuth()
@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(StaffRole.SUPPORT, StaffRole.COMPLIANCE, StaffRole.FINANCE)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  overview(@Query('days', new ParseIntPipe({ optional: true })) days?: number) {
    const allowed = [7, 30, 90];
    return this.dashboard.overview(allowed.includes(days ?? 30) ? (days ?? 30) : 30);
  }
}
