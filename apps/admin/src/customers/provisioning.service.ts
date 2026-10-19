import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedStaff } from '../auth/current-staff.decorator';
import { AUTH_DB, PAYMENT_DB } from '../database/readonly-database.module';
import { AuthClient } from './auth-client.service';

interface Ctx {
  actor: AuthenticatedStaff;
  ip: string | null;
}

export interface PendingUser {
  id: string;
  name: string;
  email: string;
}

export interface RetryResult {
  userId: string;
  queued: boolean;
  reason?: string;
}

// Auth service caps one retry call at 200 ids; so do we.
const BATCH_LIMIT = 200;

// Customers who finished signup (BVN verified + PIN set) but have no active
// NGN account number — their provisioning request failed and nothing else
// ever re-sends it. Reads come from the read-only connections; the retry
// itself is a write, so it goes through the auth service's /internal API.
@Injectable()
export class ProvisioningService {
  constructor(
    @InjectDataSource(AUTH_DB) private readonly auth: DataSource,
    @InjectDataSource(PAYMENT_DB) private readonly payment: DataSource,
    private readonly authClient: AuthClient,
    private readonly audit: AuditService,
  ) {}

  async pending(): Promise<PendingUser[]> {
    const candidates: {
      id: string;
      first_name: string;
      last_name: string;
      email: string;
    }[] = await this.auth.query(
      `SELECT id, first_name, last_name, email FROM users
        WHERE bvn_verified_at IS NOT NULL
          AND transaction_pin_set_at IS NOT NULL
          AND status NOT IN ('SUSPENDED', 'CLOSED')
        ORDER BY created_at`,
    );
    if (candidates.length === 0) return [];

    const provisioned: { user_id: string }[] = await this.payment.query(
      `SELECT DISTINCT w.user_id
         FROM wallets w JOIN addresses a ON a.wallet_id = w.id
        WHERE w.currency = 'NGN' AND a.status = 'ACTIVE'
          AND w.user_id = ANY($1::uuid[])`,
      [candidates.map((c) => c.id)],
    );
    const done = new Set(provisioned.map((p) => p.user_id));
    return candidates
      .filter((c) => !done.has(c.id))
      .map((c) => ({
        id: c.id,
        name: `${c.first_name} ${c.last_name}`.trim(),
        email: c.email,
      }));
  }

  // `userIds` omitted = every pending customer (first BATCH_LIMIT of them;
  // `remaining` says how many are left for another call). Explicit ids are
  // intersected with the pending set, so this can never re-provision a
  // customer who already has an account number.
  async retry(userIds: string[] | undefined, reason: string, ctx: Ctx) {
    const pending = await this.pending();
    const pendingIds = pending.map((p) => p.id);
    const wanted = userIds
      ? pendingIds.filter((id) => userIds.includes(id))
      : pendingIds;
    const batch = wanted.slice(0, BATCH_LIMIT);

    const results: RetryResult[] = [];
    if (batch.length > 0) {
      const res = await this.authClient.call<{ results: RetryResult[] }>(
        'POST',
        '/provisioning/retry',
        { userIds: batch },
      );
      results.push(...res.results);
    }
    const notPending = (userIds ?? []).filter((id) => !pendingIds.includes(id));

    await this.audit.record({
      staffId: ctx.actor.staffId,
      staffEmail: ctx.actor.email,
      action: 'provisioning.retried',
      resourceType: 'customer',
      metadata: {
        reason,
        requested: userIds ?? 'all-pending',
        queued: results.filter((r) => r.queued).map((r) => r.userId),
        skipped: results.filter((r) => !r.queued),
        notPending,
      },
      ip: ctx.ip,
    });

    return {
      queued: results.filter((r) => r.queued).length,
      skipped: results.filter((r) => !r.queued),
      notPending,
      remaining: wanted.length - batch.length,
    };
  }
}
