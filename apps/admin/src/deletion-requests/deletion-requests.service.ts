import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedStaff } from '../auth/current-staff.decorator';
import { AuthClient } from '../customers/auth-client.service';
import { CustomerActionsService } from '../customers/customer-actions.service';
import { CustomersService } from '../customers/customers.service';
import { AUTH_DB } from '../database/readonly-database.module';

interface Ctx {
  actor: AuthenticatedStaff;
  ip: string | null;
}

interface Row {
  id: string;
  user_id: string;
  reason: string | null;
  status: string;
  created_at: Date;
  decided_at: Date | null;
  decided_by_email: string | null;
  decision_note: string | null;
}

// Staff side of "delete my account". Approving runs the same closure flow as
// the Close account button, so its safeguards (empty wallet, nothing in
// flight, irreversible) apply identically; rejecting tells the customer why.
@Injectable()
export class DeletionRequestsService {
  constructor(
    @InjectDataSource(AUTH_DB) private readonly auth: DataSource,
    private readonly customers: CustomersService,
    private readonly actions: CustomerActionsService,
    private readonly authClient: AuthClient,
    private readonly audit: AuditService,
  ) {}

  async list(opts: { status?: string[]; page: number; pageSize: number }) {
    const params: unknown[] = [];
    let where = '';
    if (opts.status?.length) {
      params.push(opts.status);
      where = `WHERE r.status = ANY($1)`;
    }
    const [rows, total] = (await Promise.all([
      this.auth.query(
        `SELECT r.* FROM account_deletion_requests r ${where}
          ORDER BY (r.status = 'PENDING') DESC, r.created_at ASC
          LIMIT ${opts.pageSize} OFFSET ${(opts.page - 1) * opts.pageSize}`,
        params,
      ),
      this.auth.query(
        `SELECT count(*)::text AS n FROM account_deletion_requests r ${where}`,
        params,
      ),
    ])) as [Row[], { n: string }[]];
    const contacts = await this.customers.contacts(rows.map((r) => r.user_id));
    const items = await Promise.all(
      rows.map(async (r) => {
        // Only open requests need the "can this be closed?" answer.
        const blockers =
          r.status === 'PENDING'
            ? await this.customers.closureBlockers(r.user_id)
            : null;
        return {
          id: r.id,
          customerId: r.user_id,
          customer: contacts.get(r.user_id) ?? null,
          reason: r.reason,
          status: r.status,
          requestedAt: r.created_at,
          decidedAt: r.decided_at,
          decidedBy: r.decided_by_email,
          decisionNote: r.decision_note,
          walletBalance: blockers?.balance ?? null,
          paymentsInFlight: blockers?.inFlight ?? null,
        };
      }),
    );
    return {
      items,
      total: Number(total[0]?.n ?? 0),
      page: opts.page,
      pageSize: opts.pageSize,
    };
  }

  private async pending(id: string) {
    const rows: Row[] = await this.auth.query(
      `SELECT * FROM account_deletion_requests WHERE id = $1`,
      [id],
    );
    const r = rows[0];
    if (!r) throw new NotFoundException('Request not found');
    if (r.status !== 'PENDING') {
      throw new BadRequestException(
        `This request is already ${r.status.toLowerCase()}`,
      );
    }
    return r;
  }

  async approve(id: string, note: string | undefined, ctx: Ctx) {
    const request = await this.pending(id);
    // The closure flow suspends, checks the wallet, then closes (and refuses,
    // restoring the account, if money is left or payments are in flight).
    const customer = await this.actions.close(
      request.user_id,
      `Customer deletion request${note ? `: ${note}` : ''}`,
      ctx,
    );
    await this.audit.record({
      staffId: ctx.actor.staffId,
      staffEmail: ctx.actor.email,
      action: 'deletion_request.approved',
      resourceType: 'customer',
      resourceId: request.user_id,
      metadata: { requestId: id, note, customerReason: request.reason },
      ip: ctx.ip,
    });
    return customer;
  }

  async reject(id: string, reason: string, ctx: Ctx) {
    const request = await this.pending(id);
    await this.authClient.call('POST', `/deletion-requests/${id}/reject`, {
      reason,
      actorEmail: ctx.actor.email,
    });
    // The customer is shown this reason, so it is recorded as sent.
    await this.audit.record({
      staffId: ctx.actor.staffId,
      staffEmail: ctx.actor.email,
      action: 'deletion_request.rejected',
      resourceType: 'customer',
      resourceId: request.user_id,
      metadata: { requestId: id, reason },
      ip: ctx.ip,
    });
    return { id, status: 'REJECTED' };
  }
}
