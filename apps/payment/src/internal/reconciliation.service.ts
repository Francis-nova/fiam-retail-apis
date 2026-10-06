import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource } from 'typeorm';
import { CurrencyCode } from '@app/common';
import { PAYMENT_PROVIDER_REGISTRY } from '../providers/payment-provider.registry';
import type { PaymentProviderRegistry } from '../providers/payment-provider.registry';

// A payout still PENDING/PROCESSING after this long is "stuck" (the re-query
// worker normally settles them within a minute or two).
const STUCK_AFTER_MINUTES = 15;

// Compares what we owe customers with what the provider says it holds, and
// lists the exceptions a person has to deal with. Read-only.
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(PAYMENT_PROVIDER_REGISTRY)
    private readonly registry: PaymentProviderRegistry,
  ) {}

  private async providerPoolBalance(): Promise<{
    balance: string | null;
    error: string | null;
  }> {
    try {
      const provider = this.registry.getProviderForCurrency(CurrencyCode.NGN);
      const details = await provider.getAccountDetails();
      const raw = details.balance;
      if (raw === null || raw === undefined || raw === '') {
        return {
          balance: null,
          error: 'The provider did not report a balance',
        };
      }
      const n = new Decimal(raw);
      return { balance: n.toFixed(2), error: null };
    } catch (err) {
      this.logger.warn(
        `Provider balance unavailable: ${(err as Error).message}`,
      );
      return { balance: null, error: 'Could not reach the provider' };
    }
  }

  async summary() {
    const [ledgerRows, activityRows, unmatchedRows, stuckRows, pool] =
      await Promise.all([
        this.dataSource.query<{ total: string; wallets: number }[]>(
          `SELECT COALESCE(SUM(balance), 0)::text AS total, count(*)::int AS wallets
             FROM wallets WHERE currency = $1`,
          [CurrencyCode.NGN],
        ),
        this.dataSource.query<
          { credits: string; debits: string; fees: string; count: number }[]
        >(
          `SELECT
             COALESCE(SUM(amount) FILTER (WHERE type='CREDIT'), 0)::text AS credits,
             COALESCE(SUM(amount) FILTER (WHERE type='DEBIT'),  0)::text AS debits,
             COALESCE(SUM(fee), 0)::text AS fees,
             count(*)::int AS count
           FROM transactions
          WHERE status = 'SUCCESSFUL' AND currency = $1
            AND created_at >= now() - interval '24 hours'`,
          [CurrencyCode.NGN],
        ),
        this.dataSource.query<
          { id: string; amount: string; created_at: Date; reference: string }[]
        >(
          `SELECT id, amount::text, created_at, reference FROM transactions
            WHERE status = 'UNMATCHED' ORDER BY created_at ASC LIMIT 50`,
        ),
        this.dataSource.query<
          {
            id: string;
            amount: string;
            created_at: Date;
            reference: string;
            status: string;
          }[]
        >(
          `SELECT id, amount::text, created_at, reference, status FROM transactions
            WHERE type = 'DEBIT' AND provider <> 'MANUAL'
              AND status IN ('PENDING','PROCESSING')
              AND created_at < now() - make_interval(mins => $1)
            ORDER BY created_at ASC LIMIT 50`,
          [STUCK_AFTER_MINUTES],
        ),
        this.providerPoolBalance(),
      ]);

    const owed = new Decimal(ledgerRows[0]?.total ?? 0);
    // provider − ledger: positive = the provider holds more than we owe
    // customers (our own fee income sits here); negative = a shortfall.
    const difference = pool.balance
      ? new Decimal(pool.balance).minus(owed)
      : null;

    const sum = (rows: { amount: string }[]) =>
      rows.reduce((a, r) => a.plus(r.amount), new Decimal(0));

    return {
      currency: CurrencyCode.NGN,
      generatedAt: new Date().toISOString(),
      ledger: {
        owedToCustomers: owed.toFixed(2),
        wallets: ledgerRows[0]?.wallets ?? 0,
      },
      provider: {
        poolBalance: pool.balance,
        error: pool.error,
      },
      difference: difference ? difference.toFixed(2) : null,
      shortfall: difference ? difference.lessThan(0) : null,
      last24h: {
        transactions: activityRows[0]?.count ?? 0,
        credits: new Decimal(activityRows[0]?.credits ?? 0).toFixed(2),
        debits: new Decimal(activityRows[0]?.debits ?? 0).toFixed(2),
        fees: new Decimal(activityRows[0]?.fees ?? 0).toFixed(2),
      },
      unmatched: {
        count: unmatchedRows.length,
        total: sum(unmatchedRows).toFixed(2),
        items: unmatchedRows,
      },
      stuckPayouts: {
        afterMinutes: STUCK_AFTER_MINUTES,
        count: stuckRows.length,
        total: sum(stuckRows).toFixed(2),
        items: stuckRows,
      },
    };
  }
}
