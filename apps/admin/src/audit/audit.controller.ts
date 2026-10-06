import {
  Controller,
  Get,
  Header,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { StaffRole } from '../staff/entities/staff-user.entity';
import { toCsv } from '../common/csv';
import {
  AuthenticatedStaff,
  ClientIp,
  CurrentStaff,
} from '../auth/current-staff.decorator';
import { AuditService } from './audit.service';
import { ListAuditQueryDto } from './dto/list-audit-query.dto';

@ApiBearerAuth()
@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(StaffRole.SUPER_ADMIN, StaffRole.COMPLIANCE)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  // The evidence trail as a file, for compliance reviews and regulators.
  // Exporting is itself audited.
  @Get('export')
  @Header('Cache-Control', 'no-store')
  async export(
    @Query() q: ListAuditQueryDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    const { items, truncated } = await this.audit.listForExport(
      { staffId: q.staffId, action: q.action, resourceId: q.resourceId },
      50_000,
    );
    await this.audit.record({
      staffId: actor.staffId,
      staffEmail: actor.email,
      action: 'audit.exported',
      metadata: { filters: q, rows: items.length, truncated },
      ip,
    });
    const csv = toCsv(
      [
        'Time (UTC)',
        'Staff',
        'Action',
        'Resource type',
        'Resource id',
        'IP',
        'Details',
      ],
      items.map((a) => [
        a.createdAt,
        a.staffEmail,
        a.action,
        a.resourceType,
        a.resourceId,
        a.ip,
        a.metadata,
      ]),
    );
    return new StreamableFile(Buffer.from(csv, 'utf8'), {
      type: 'text/csv; charset=utf-8',
      disposition: `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.csv"`,
    });
  }

  @Get()
  list(@Query() q: ListAuditQueryDto) {
    return this.audit.list({
      staffId: q.staffId,
      action: q.action,
      resourceId: q.resourceId,
      page: q.page ?? 1,
      pageSize: q.pageSize ?? 25,
    });
  }
}
