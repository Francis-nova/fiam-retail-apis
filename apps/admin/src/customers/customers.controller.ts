import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
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
import { TransactionsService } from '../transactions/transactions.service';
import { ListTransactionsQueryDto } from '../transactions/dto/list-transactions-query.dto';
import { CustomersService } from './customers.service';
import { CustomerActionsService } from './customer-actions.service';
import { ListCustomersQueryDto } from './dto/list-customers-query.dto';
import {
  ApproveUpgradeDto,
  ReasonDto,
  UpdateCustomerDto,
} from './dto/customer-actions.dto';

// Only compliance (and super admins, who pass every role check) review
// customer accounts: the KYC queue and every account-changing action.
export const REVIEWER_ROLES: StaffRole[] = [
  StaffRole.SUPER_ADMIN,
  StaffRole.COMPLIANCE,
];

@ApiBearerAuth()
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(StaffRole.SUPPORT, StaffRole.COMPLIANCE, StaffRole.FINANCE)
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly actions: CustomerActionsService,
    private readonly transactions: TransactionsService,
    private readonly audit: AuditService,
  ) {}

  // Filtering by tier-upgrade status is the KYC review queue.
  @Get()
  list(
    @Query() q: ListCustomersQueryDto,
    @CurrentStaff() actor: AuthenticatedStaff,
  ) {
    if (q.tierUpgradeStatus && !REVIEWER_ROLES.includes(actor.role)) {
      throw new ForbiddenException('Insufficient role for the review queue');
    }
    return this.customers.list(q);
  }

  @Get(':id')
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    const customer = await this.customers.get(id);
    await this.audit.recordSafe({
      staffId: actor.staffId,
      staffEmail: actor.email,
      action: 'customer.viewed',
      resourceType: 'customer',
      resourceId: id,
      ip,
    });
    return customer;
  }

  @Get(':id/transactions')
  async customerTransactions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() q: ListTransactionsQueryDto,
  ) {
    await this.customers.assertExists(id);
    return this.transactions.list({ ...q, userId: id, walletId: undefined });
  }

  @Get(':id/wallet')
  wallet(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.customers.wallet(id);
  }

  @Get(':id/sessions')
  sessions(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.customers.sessions(id);
  }

  @Get(':id/devices')
  devices(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.customers.devices(id);
  }

  // --- KYC review workspace: compliance / super admin only ---

  @Get(':id/kyc')
  @Roles(...REVIEWER_ROLES)
  kyc(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.customers.kyc(id);
  }

  @Get(':id/kyc-documents/:docId/file')
  @Roles(...REVIEWER_ROLES)
  async kycFile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.actions.viewDocument(id, docId, { actor, ip });
    const inline = /^(image\/(jpeg|png|heic)|application\/pdf)$/.test(
      file.mimeType,
    );
    res.set({
      'Content-Type': inline ? file.mimeType : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.filename)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(file.buffer);
  }

  @Post(':id/tier-upgrade/approve')
  @HttpCode(200)
  @Roles(...REVIEWER_ROLES)
  approveUpgrade(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ApproveUpgradeDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    return this.actions.approveUpgrade(id, dto.note, { actor, ip });
  }

  @Post(':id/tier-upgrade/reject')
  @HttpCode(200)
  @Roles(...REVIEWER_ROLES)
  rejectUpgrade(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    return this.actions.rejectUpgrade(id, dto.reason, { actor, ip });
  }

  // --- Account actions: compliance / super admin only ---

  @Patch(':id')
  @Roles(...REVIEWER_ROLES)
  update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    return this.actions.update(id, dto, { actor, ip });
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @Roles(...REVIEWER_ROLES)
  suspend(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    return this.actions.suspend(id, dto.reason, { actor, ip });
  }

  // Support and compliance can unlock a customer who locked themselves out.
  @Post(':id/clear-lockouts')
  @HttpCode(200)
  @Roles(StaffRole.SUPPORT, StaffRole.COMPLIANCE)
  clearLockouts(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    return this.actions.clearLockouts(id, dto.reason, { actor, ip });
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @Roles(...REVIEWER_ROLES)
  reactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    return this.actions.reactivate(id, dto.reason, { actor, ip });
  }

  @Post(':id/close')
  @HttpCode(200)
  @Roles(...REVIEWER_ROLES)
  close(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    return this.actions.close(id, dto.reason, { actor, ip });
  }

  @Post(':id/sessions/revoke')
  @HttpCode(200)
  @Roles(...REVIEWER_ROLES)
  revokeSessions(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ReasonDto,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    return this.actions.revokeSessions(id, dto.reason, { actor, ip });
  }

  @Delete(':id/sessions/:sessionId')
  @Roles(...REVIEWER_ROLES)
  revokeSession(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
    @CurrentStaff() actor: AuthenticatedStaff,
    @ClientIp() ip: string | null,
  ) {
    return this.actions.revokeSession(id, sessionId, { actor, ip });
  }
}
