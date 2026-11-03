import {
  Body,
  Controller,
  Get,
  HttpCode,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import {
  AuthenticatedStaff,
  ClientIp,
  CurrentStaff,
} from '../auth/current-staff.decorator';
import { StaffRole } from '../staff/entities/staff-user.entity';
import { AuditService } from '../audit/audit.service';
import { InternalHttp } from '../common/internal-http.service';

class SetFreePayoutsDto {
  @IsBoolean()
  enabled!: boolean;
}

// The "first 2 payouts a day are free" rule. Off means every payout carries
// its fee (plus 7.5% VAT, which is not switchable). SUPER_ADMIN passes too.
@ApiBearerAuth()
@Controller('settings/free-payouts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(StaffRole.FINANCE)
export class SettingsController {
  constructor(
    private readonly http: InternalHttp,
    private readonly audit: AuditService,
  ) {}

  @Get()
  get() {
    return this.http.call<{ enabled: boolean }>(
      'payment',
      'GET',
      '/settings/free-payouts',
    );
  }

  @Put()
  @HttpCode(200)
  async set(
    @Body() dto: SetFreePayoutsDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    const before = await this.get();
    const after = await this.http.call<{ enabled: boolean }>(
      'payment',
      'PUT',
      '/settings/free-payouts',
      { enabled: dto.enabled },
    );
    await this.audit.record({
      staffId: actor.staffId,
      staffEmail: actor.email,
      action: 'settings.free_payouts_toggled',
      resourceType: 'setting',
      resourceId: 'free_payouts_enabled',
      metadata: { before: before.enabled, after: after.enabled },
      ip,
    });
    return after;
  }
}
