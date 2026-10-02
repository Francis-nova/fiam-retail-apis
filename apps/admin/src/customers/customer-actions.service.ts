import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedStaff } from '../auth/current-staff.decorator';
import { AuthClient } from './auth-client.service';
import { CustomersService } from './customers.service';
import { UpdateCustomerDto } from './dto/customer-actions.dto';

interface Ctx {
  actor: AuthenticatedStaff;
  ip: string | null;
}

// State-changing customer actions: call the auth service, then audit. Reasons
// are mandatory and recorded; the audit write is awaited so a failure to log
// fails the request loudly (see AuditService.record).
@Injectable()
export class CustomerActionsService {
  constructor(
    private readonly customers: CustomersService,
    private readonly authClient: AuthClient,
    private readonly audit: AuditService,
  ) {}

  private record(
    { actor, ip }: Ctx,
    action: string,
    id: string,
    metadata: Record<string, unknown>,
  ) {
    return this.audit.record({
      staffId: actor.staffId,
      staffEmail: actor.email,
      action,
      resourceType: 'customer',
      resourceId: id,
      metadata,
      ip,
    });
  }

  async update(id: string, dto: UpdateCustomerDto, ctx: Ctx) {
    const before = await this.customers.snapshot(id);
    // Explicit allow-list: anything else in the body (e.g. email) is ignored,
    // and the audit entry must only ever describe what was really changed.
    const { reason } = dto;
    const fields: { firstName?: string; lastName?: string; phone?: string } =
      {};
    if (dto.firstName !== undefined) fields.firstName = dto.firstName;
    if (dto.lastName !== undefined) fields.lastName = dto.lastName;
    if (dto.phone !== undefined) fields.phone = dto.phone;
    if (Object.keys(fields).length === 0) {
      throw new BadRequestException('Nothing to change');
    }
    await this.authClient.call('PATCH', `/users/${id}/profile`, fields);
    await this.record(ctx, 'customer.updated', id, {
      reason,
      before: {
        firstName: before.first_name,
        lastName: before.last_name,
        phone: before.phone,
      },
      changes: fields,
    });
    return this.customers.get(id);
  }

  async suspend(id: string, reason: string, ctx: Ctx) {
    const before = await this.customers.snapshot(id);
    await this.authClient.call('POST', `/users/${id}/suspend`);
    await this.record(ctx, 'customer.suspended', id, {
      reason,
      previousStatus: before.status,
    });
    return this.customers.get(id);
  }

  async reactivate(id: string, reason: string, ctx: Ctx) {
    await this.authClient.call('POST', `/users/${id}/reactivate`);
    await this.record(ctx, 'customer.reactivated', id, { reason });
    return this.customers.get(id);
  }

  async revokeSessions(id: string, reason: string, ctx: Ctx) {
    await this.authClient.call('POST', `/users/${id}/sessions/revoke`);
    await this.record(ctx, 'customer.sessions_revoked', id, { reason });
    return { revoked: true };
  }

  async revokeSession(id: string, sessionId: string, ctx: Ctx) {
    await this.authClient.call('DELETE', `/users/${id}/sessions/${sessionId}`);
    await this.record(ctx, 'customer.session_revoked', id, { sessionId });
    return { revoked: true };
  }

  // Closure is irreversible, so: block the account first (no new logins or
  // payments while we look), refuse if money is left or payments are in
  // flight, and put the account back how we found it if we refuse.
  async close(id: string, reason: string, ctx: Ctx) {
    const before = await this.customers.snapshot(id);
    if (before.status === 'CLOSED') {
      throw new BadRequestException('This account is already closed');
    }
    const weSuspended = before.status !== 'SUSPENDED';
    if (weSuspended) await this.authClient.call('POST', `/users/${id}/suspend`);

    const blockers = await this.customers.closureBlockers(id);
    if (Number(blockers.balance) !== 0 || blockers.inFlight > 0) {
      // Reactivate restores ACTIVE or PENDING_VERIFICATION as appropriate.
      if (weSuspended) {
        await this.authClient.call('POST', `/users/${id}/reactivate`);
      }
      throw new BadRequestException(
        Number(blockers.balance) !== 0
          ? `Wallet balance must be zero before closing (currently ${blockers.balance}).`
          : `${blockers.inFlight} payment(s) are still in progress; wait for them to finish.`,
      );
    }

    await this.authClient.call('POST', `/users/${id}/close`, {
      actorEmail: ctx.actor.email,
    });
    // The original contact details are gone from the customer record after
    // this, so the audit entry is where they remain traceable.
    await this.record(ctx, 'customer.closed', id, {
      reason,
      previousStatus: before.status,
      email: before.email,
      phone: before.phone,
      name: `${before.first_name} ${before.last_name}`.trim(),
    });
    return this.customers.get(id);
  }

  // --- KYC / tier-upgrade review ---

  async approveUpgrade(id: string, note: string | undefined, ctx: Ctx) {
    const before = await this.customers.snapshot(id);
    await this.authClient.call('POST', `/users/${id}/tier-upgrade/approve`);
    await this.record(ctx, 'kyc.approved', id, {
      note,
      previousTier: before.tier,
      newTier: 'TIER_3',
    });
    return this.customers.get(id);
  }

  async rejectUpgrade(id: string, reason: string, ctx: Ctx) {
    await this.authClient.call('POST', `/users/${id}/tier-upgrade/reject`, {
      reason,
    });
    // The customer is shown this reason, so it's recorded as sent.
    await this.record(ctx, 'kyc.rejected', id, { reason });
    return this.customers.get(id);
  }

  // Identity documents: every view is audited, and the audit write is awaited
  // *before* the file is returned, so there is no unlogged access.
  async viewDocument(id: string, docId: string, ctx: Ctx) {
    const meta = await this.customers.documentMeta(id, docId);
    await this.record(ctx, 'kyc.document_viewed', id, {
      docId,
      docType: meta.doc_type,
    });
    const file = await this.authClient.file(
      `/users/${id}/kyc-documents/${docId}/file`,
    );
    return {
      ...file,
      mimeType: meta.mime_type,
      filename: meta.original_filename,
    };
  }
}
