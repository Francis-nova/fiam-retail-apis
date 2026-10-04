import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  StreamableFile,
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
import { InternalHttp } from '../common/internal-http.service';
import { toCsv } from '../common/csv';
import { TransactionsService } from './transactions.service';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';

// Upper bound for one CSV export; the response says when it was cut short.
const EXPORT_MAX_ROWS = 20_000;

@ApiBearerAuth()
@Controller('transactions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(StaffRole.SUPPORT, StaffRole.FINANCE)
export class TransactionsController {
  constructor(
    private readonly transactions: TransactionsService,
    private readonly audit: AuditService,
    private readonly http: InternalHttp,
  ) {}

  @Get()
  list(@Query() q: ListTransactionsQueryDto) {
    return this.transactions.list(q);
  }

  // Finance export of whatever the Transactions screen is filtered to. It
  // carries customer names, so it is restricted and every export is audited
  // with its filters and row count. Declared before ':id' so it isn't
  // mistaken for an id.
  @Get('export')
  @Roles(StaffRole.FINANCE)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async export(
    @Query() q: ListTransactionsQueryDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    const { items, truncated } = await this.transactions.exportRows(
      q,
      EXPORT_MAX_ROWS,
    );
    await this.audit.record({
      staffId: actor.staffId,
      staffEmail: actor.email,
      action: 'transactions.exported',
      resourceType: 'transaction',
      metadata: { filters: q, rows: items.length, truncated },
      ip,
    });
    const csv = toCsv(
      [
        'Date (UTC)',
        'Reference',
        'Type',
        'Status',
        'Currency',
        'Amount',
        'Fee',
        'Provider',
        'Customer',
        'Customer email',
        'Counterparty',
        'Counterparty account',
        'Counterparty bank code',
        'Narration',
      ],
      items.map((t) => [
        t.createdAt,
        t.reference,
        t.type,
        t.status,
        t.currency,
        t.amount,
        t.fee,
        t.provider,
        t.customer?.name,
        t.customer?.email,
        t.counterparty.name,
        t.counterparty.accountNumber,
        t.counterparty.bankCode,
        t.narration,
      ]),
    );
    const name = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="${name}"`,
    });
  }

  // Asks the provider where a stuck payout stands. It never guesses: an
  // unanswered query changes nothing, and only a definitive FAILED refunds.
  @Post(':id/requery')
  @HttpCode(200)
  @Roles(StaffRole.FINANCE)
  async requery(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    const result = await this.http.call<{
      outcome: string;
      status: string;
      providerStatusCode: string | null;
    }>('payment', 'POST', `/transactions/${id}/requery`);
    await this.audit.record({
      staffId: actor.staffId,
      staffEmail: actor.email,
      action: 'transaction.requeried',
      resourceType: 'transaction',
      resourceId: id,
      metadata: { ...result },
      ip,
    });
    return result;
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
