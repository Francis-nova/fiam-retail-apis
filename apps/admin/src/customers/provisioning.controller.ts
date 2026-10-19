import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import {
  AuthenticatedStaff,
  ClientIp,
  CurrentStaff,
} from '../auth/current-staff.decorator';
import { StaffRole } from '../staff/entities/staff-user.entity';
import { RetryProvisioningDto } from './dto/customer-actions.dto';
import { ProvisioningService } from './provisioning.service';

// Re-sends failed NGN account-number requests. Same roles as the other
// account-changing actions.
@ApiBearerAuth()
@Controller('provisioning')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(StaffRole.COMPLIANCE, StaffRole.FINANCE)
export class ProvisioningController {
  constructor(private readonly provisioning: ProvisioningService) {}

  // Customers with no account number yet.
  @Get('pending')
  async pending() {
    const users = await this.provisioning.pending();
    return { count: users.length, users };
  }

  // Body `userIds` optional: omit to retry everyone pending.
  @Post('retry')
  @HttpCode(200)
  retry(
    @Body() dto: RetryProvisioningDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    return this.provisioning.retry(dto.userIds, dto.reason, { actor, ip });
  }
}
