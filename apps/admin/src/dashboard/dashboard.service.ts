import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AUTH_DB, PAYMENT_DB } from '../database/readonly-database.module';

// Volumes are NGN only: mixing currencies in one number would be meaningless.
const CURRENCY = 'NGN';

const num = (v: unknown) => Number(v ?? 0);

@Injectable()
export class DashboardService {
  constructor(
    @InjectDataSource(PAYMENT_DB) private readonly payment: DataSource,
    @InjectDataSource(AUTH_DB) private readonly auth: DataSource,
  ) {}

  private async txTotals(from: Date, to: Date) {
    const [r] = await this.payment.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE type='CREDIT' AND status='SUCCESSFUL'), 0) AS inflow,
         COALESCE(SUM(amount) FILTER (WHERE type='DEBIT'  AND status='SUCCESSFUL'), 0) AS outflow,
         COALESCE(SUM(fee)    FILTER (WHERE status='SUCCESSFUL'), 0) AS fees,
         count(*)::int AS total,
         count(*) FILTER (WHERE status='SUCCESSFUL')::int AS successful,
         count(*) FILTER (WHERE status IN ('FAILED','UNMATCHED'))::int AS problem,
         count(DISTINCT wallet_id) FILTER (WHERE status='SUCCESSFUL')::int AS active_wallets
       FROM transactions
       WHERE currency = $1 AND created_at >= $2 AND created_at < $3`,
      [CURRENCY, from, to],
    );
    return {
      inflow: num(r.inflow),
      outflow: num(r.outflow),
      fees: num(r.fees),
      total: r.total as number,
      successful: r.successful as number,
      problem: r.problem as number,
      activeWallets: r.active_wallets as number,
    };
  }

  private async signups(from: Date, to: Date) {
    const [r] = await this.auth.query(
      `SELECT count(*)::int AS n FROM users WHERE created_at >= $1 AND created_at < $2`,
      [from, to],
    );
    return r.n as number;
  }

  async overview(days: number) {
    const now = new Date();
    const from = new Date(now.getTime() - days * 86_400_000);
    const prevFrom = new Date(from.getTime() - days * 86_400_000);

    const [cur, prev, signupsCur, signupsPrev] = await Promise.all([
      this.txTotals(from, now),
      this.txTotals(prevFrom, from),
      this.signups(from, now),
      this.signups(prevFrom, from),
    ]);

    const [daily, signupDaily, byStatus, byProvider, byType, wallet, pending] =
      await Promise.all([
        this.payment.query(
          `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                  COALESCE(SUM(amount) FILTER (WHERE type='CREDIT' AND status='SUCCESSFUL'), 0) AS inflow,
                  COALESCE(SUM(amount) FILTER (WHERE type='DEBIT'  AND status='SUCCESSFUL'), 0) AS outflow,
                  count(*)::int AS count
             FROM transactions
            WHERE currency = $1 AND created_at >= $2
            GROUP BY 1 ORDER BY 1`,
          [CURRENCY, from],
        ),
        this.auth.query(
          `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS n
             FROM users WHERE created_at >= $1 GROUP BY 1`,
          [from],
        ),
        this.payment.query(
          `SELECT status, count(*)::int AS n FROM transactions
            WHERE currency = $1 AND created_at >= $2 GROUP BY 1`,
          [CURRENCY, from],
        ),
        this.payment.query(
          `SELECT provider, count(*)::int AS n,
                  COALESCE(SUM(amount) FILTER (WHERE status='SUCCESSFUL'), 0) AS volume
             FROM transactions WHERE currency = $1 AND created_at >= $2
            GROUP BY 1 ORDER BY volume DESC`,
          [CURRENCY, from],
        ),
        this.payment.query(
          `SELECT type, count(*)::int AS n,
                  COALESCE(AVG(amount) FILTER (WHERE status='SUCCESSFUL'), 0) AS avg_amount
             FROM transactions WHERE currency = $1 AND created_at >= $2 GROUP BY 1`,
          [CURRENCY, from],
        ),
        this.payment.query(
          `SELECT COALESCE(SUM(balance), 0) AS held, count(*)::int AS wallets
             FROM wallets WHERE currency = $1`,
          [CURRENCY],
        ),
        this.payment.query(
          `SELECT count(*)::int AS n FROM transactions
            WHERE status IN ('PENDING','PROCESSING') AND created_at < now() - interval '15 minutes'`,
        ),
      ]);

    const [custStatus, custTier, review] = await Promise.all([
      this.auth.query(`SELECT status, count(*)::int AS n FROM users GROUP BY 1`),
      this.auth.query(
        `SELECT tier, count(*)::int AS n FROM users WHERE status <> 'CLOSED' GROUP BY 1 ORDER BY 1`,
      ),
      this.auth.query(
        `SELECT
           (SELECT count(*)::int FROM users WHERE tier_upgrade_status = 'UNDER_REVIEW') AS kyc,
           (SELECT count(*)::int FROM account_deletion_requests WHERE status = 'PENDING') AS deletions`,
      ),
    ]);

    // Fill every day in the window so the charts have no gaps.
    const byDay = new Map<string, { inflow: number; outflow: number; count: number }>(
      daily.map((d: any) => [
        d.day,
        { inflow: num(d.inflow), outflow: num(d.outflow), count: d.count },
      ]),
    );
    const signupByDay = new Map<string, number>(
      signupDaily.map((d: any) => [d.day, d.n]),
    );
    const series: {
      date: string;
      inflow: number;
      outflow: number;
      count: number;
      signups: number;
    }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now.getTime() - i * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const d = byDay.get(date);
      series.push({
        date,
        inflow: d?.inflow ?? 0,
        outflow: d?.outflow ?? 0,
        count: d?.count ?? 0,
        signups: signupByDay.get(date) ?? 0,
      });
    }

    return {
      currency: CURRENCY,
      days,
      generatedAt: now.toISOString(),
      current: { ...cur, signups: signupsCur },
      previous: { ...prev, signups: signupsPrev },
      series,
      byStatus: byStatus.map((r: any) => ({ status: r.status, count: r.n })),
      byProvider: byProvider.map((r: any) => ({
        provider: r.provider,
        count: r.n,
        volume: num(r.volume),
      })),
      byType: byType.map((r: any) => ({
        type: r.type,
        count: r.n,
        avgAmount: num(r.avg_amount),
      })),
      heldBalance: num(wallet[0]?.held),
      walletCount: wallet[0]?.wallets ?? 0,
      stuckPayments: pending[0]?.n ?? 0,
      customers: {
        byStatus: custStatus.map((r: any) => ({ status: r.status, count: r.n })),
        byTier: custTier.map((r: any) => ({ tier: r.tier, count: r.n })),
      },
      queues: { kycReview: review[0]?.kyc ?? 0, deletionRequests: review[0]?.deletions ?? 0 },
    };
  }
}
