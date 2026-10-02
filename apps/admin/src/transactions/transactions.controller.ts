import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
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
import { AuditService } from '../audit/audit.service';
import { TransactionsService } from './transactions.service';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';

@ApiBearerAuth()
@Controller('transactions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(StaffRole.SUPPORT, StaffRole.FINANCE)
export class TransactionsController {
  constructor(
    private readonly transactions: TransactionsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query() q: ListTransactionsQueryDto) {
    return this.transactions.list(q);
  }

  // The detail carries the raw provider payload, so opening one is recorded.
  @Get(':id')
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    const tx = await this.transactions.get(id);
    await this.audit.recordSafe({
      staffId: actor.staffId,
      staffEmail: actor.email,
      action: 'transaction.viewed',
      resourceType: 'transaction',
      resourceId: id,
      ip,
    });
    return tx;
  }
}
