import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { StaffRole } from '../staff/entities/staff-user.entity';
import { InternalHttp } from '../common/internal-http.service';

// What we owe customers vs what the provider says it holds, plus the
// exceptions (unmatched deposits, stuck payouts) someone has to resolve.
// Computed by the payment service, which owns the ledger.
@ApiBearerAuth()
@Controller('reconciliation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(StaffRole.FINANCE, StaffRole.COMPLIANCE)
export class ReconciliationController {
  constructor(private readonly http: InternalHttp) {}

  @Get()
  summary() {
    return this.http.call('payment', 'GET', '/reconciliation');
  }
}
