import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AUTH_DB, PAYMENT_DB } from '../database/readonly-database.module';

// Volumes are NGN only: mixing currencies in one number would be meaningless.
const CURRENCY = 'NGN';

const num = (v: unknown) => Number(v ?? 0);

type Row = Record<string, unknown>;

// DataSource.query() is typed `any`; every raw query here returns flat rows.
const q = (ds: DataSource, sql: string, params?: unknown[]): Promise<Row[]> =>
  ds.query(sql, params);

@Injectable()
export class DashboardService {
  constructor(
    @InjectDataSource(PAYMENT_DB) private readonly payment: DataSource,
    @InjectDataSource(AUTH_DB) private readonly auth: DataSource,
  ) {}

  private async txTotals(from: Date, to: Date) {
    const [r = {}] = await q(
      this.payment,
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
      total: num(r.total),
      successful: num(r.successful),
      problem: num(r.problem),
      activeWallets: num(r.active_wallets),
    };
  }

  private async signups(from: Date, to: Date) {
    const [r = {}] = await q(
      this.auth,
      `SELECT count(*)::int AS n FROM users WHERE created_at >= $1 AND created_at < $2`,
      [from, to],
    );
    return num(r.n);
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
        q(
          this.payment,
          `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
                  COALESCE(SUM(amount) FILTER (WHERE type='CREDIT' AND status='SUCCESSFUL'), 0) AS inflow,
                  COALESCE(SUM(amount) FILTER (WHERE type='DEBIT'  AND status='SUCCESSFUL'), 0) AS outflow,
                  count(*)::int AS count
             FROM transactions
            WHERE currency = $1 AND created_at >= $2
            GROUP BY 1 ORDER BY 1`,
          [CURRENCY, from],
        ),
        q(
          this.auth,
          `SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day, count(*)::int AS n
             FROM users WHERE created_at >= $1 GROUP BY 1`,
          [from],
        ),
        q(
          this.payment,
          `SELECT status, count(*)::int AS n FROM transactions
            WHERE currency = $1 AND created_at >= $2 GROUP BY 1`,
          [CURRENCY, from],
        ),
        q(
          this.payment,
          `SELECT provider, count(*)::int AS n,
                  COALESCE(SUM(amount) FILTER (WHERE status='SUCCESSFUL'), 0) AS volume
             FROM transactions WHERE currency = $1 AND created_at >= $2
            GROUP BY 1 ORDER BY volume DESC`,
          [CURRENCY, from],
        ),
        q(
          this.payment,
          `SELECT type, count(*)::int AS n,
                  COALESCE(AVG(amount) FILTER (WHERE status='SUCCESSFUL'), 0) AS avg_amount
             FROM transactions WHERE currency = $1 AND created_at >= $2 GROUP BY 1`,
          [CURRENCY, from],
        ),
        q(
          this.payment,
          `SELECT COALESCE(SUM(balance), 0) AS held, count(*)::int AS wallets
             FROM wallets WHERE currency = $1`,
          [CURRENCY],
        ),
        q(
          this.payment,
          `SELECT count(*)::int AS n FROM transactions
            WHERE status IN ('PENDING','PROCESSING') AND created_at < now() - interval '15 minutes'`,
        ),
      ]);

    const [custStatus, custTier, review] = await Promise.all([
      q(this.auth, `SELECT status, count(*)::int AS n FROM users GROUP BY 1`),
      q(
        this.auth,
        `SELECT tier, count(*)::int AS n FROM users WHERE status <> 'CLOSED' GROUP BY 1 ORDER BY 1`,
      ),
      q(
        this.auth,
        `SELECT
           (SELECT count(*)::int FROM users WHERE tier_upgrade_status = 'UNDER_REVIEW') AS kyc,
           (SELECT count(*)::int FROM account_deletion_requests WHERE status = 'PENDING') AS deletions`,
      ),
    ]);

    // Fill every day in the window so the charts have no gaps.
    const byDay = new Map<
      string,
      { inflow: number; outflow: number; count: number }
    >(
      daily.map(
        (d): [string, { inflow: number; outflow: number; count: number }] => [
          String(d.day),
          {
            inflow: num(d.inflow),
            outflow: num(d.outflow),
            count: num(d.count),
          },
        ],
      ),
    );
    const signupByDay = new Map<string, number>(
      signupDaily.map((d): [string, number] => [String(d.day), num(d.n)]),
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
      byStatus: byStatus.map((r) => ({ status: r.status, count: num(r.n) })),
      byProvider: byProvider.map((r) => ({
        provider: r.provider,
        count: num(r.n),
        volume: num(r.volume),
      })),
      byType: byType.map((r) => ({
        type: r.type,
        count: num(r.n),
        avgAmount: num(r.avg_amount),
      })),
      heldBalance: num(wallet[0]?.held),
      walletCount: num(wallet[0]?.wallets),
      stuckPayments: num(pending[0]?.n),
      customers: {
        byStatus: custStatus.map((r) => ({
          status: r.status,
          count: num(r.n),
        })),
        byTier: custTier.map((r) => ({ tier: r.tier, count: num(r.n) })),
      },
      queues: {
        kycReview: num(review[0]?.kyc),
        deletionRequests: num(review[0]?.deletions),
      },
    };
  }
}
