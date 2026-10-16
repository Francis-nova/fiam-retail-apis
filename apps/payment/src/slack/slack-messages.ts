import Decimal from 'decimal.js';
import {
  Transaction,
  TransactionKind,
  TransactionType,
} from '../transactions/entities/transaction.entity';

// Message builders for the payment-service Slack feeds. Pure functions so the
// wording and what is (and is not) disclosed can be tested. Only identifiers,
// amounts and provider codes go in: no names, emails, account numbers, PINs.

export function naira(value: string | number | Decimal): string {
  const amount = new Decimal(value);
  const fixed = amount.abs().toFixed(2);
  const [whole, fraction] = fixed.split('.');
  return `${amount.isNegative() ? '-' : ''}₦${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

export type AlertableTransaction = Partial<
  Pick<
    Transaction,
    | 'type'
    | 'kind'
    | 'billType'
    | 'amount'
    | 'fee'
    | 'reference'
    | 'providerStatusCode'
    | 'bill'
    | 'rawPayload'
  >
>;

export type PaymentOutcome = 'SUCCESSFUL' | 'FAILED';

function title(tx: AlertableTransaction): string {
  switch (tx.kind) {
    case TransactionKind.DEPOSIT:
      return 'Deposit';
    case TransactionKind.PAYOUT:
      return 'Transfer out';
    case TransactionKind.BILL_PAYMENT: {
      const what = [tx.billType, tx.bill?.billerName]
        .filter(Boolean)
        .join(' · ');
      return what ? `Bill payment · ${what}` : 'Bill payment';
    }
    case TransactionKind.ADJUSTMENT:
      return `Manual adjustment (${tx.type === TransactionType.CREDIT ? 'credit' : 'debit'})`;
    case TransactionKind.REVERSAL:
      return 'Refund';
    default:
      return tx.type === TransactionType.CREDIT ? 'Credit' : 'Debit';
  }
}

export function transactionMessage(
  tx: AlertableTransaction,
  outcome: PaymentOutcome,
  context: { environment: string; userId?: string | null },
): string {
  const ok = outcome === 'SUCCESSFUL';
  const direction =
    tx.type === TransactionType.CREDIT ? ':arrow_down:' : ':arrow_up:';
  const headline = `${ok ? ':white_check_mark:' : ':x:'} ${direction} *${title(tx)}* ${ok ? 'successful' : 'FAILED'} — ${naira(tx.amount ?? 0)} · ${context.environment}`;
  const lines = [headline];
  if (tx.fee && new Decimal(tx.fee).greaterThan(0)) {
    lines.push(`• fee: ${naira(tx.fee)}`);
  }
  if (tx.reference) lines.push(`• reference: ${tx.reference}`);
  if (context.userId) lines.push(`• user: ${context.userId}`);
  if (!ok) {
    const message = tx.rawPayload?.message;
    if (tx.providerStatusCode)
      lines.push(`• provider code: ${tx.providerStatusCode}`);
    if (typeof message === 'string' && message) {
      lines.push(`• provider message: ${message.slice(0, 300)}`);
    }
    if (tx.type === TransactionType.DEBIT)
      lines.push('• the customer was refunded');
  }
  return lines.join('\n');
}

export interface PoolBalanceReport {
  // VFD pool account balance, naira.
  pool: Decimal;
  // Sum of every customer's NGN wallet.
  customers: Decimal;
  customerCount: number;
  environment: string;
  at: Date;
}

export function poolBalanceMessage(report: PoolBalanceReport): string {
  const surplus = report.pool.minus(report.customers);
  const covered = surplus.greaterThanOrEqualTo(0);
  const when = report.at.toLocaleString('en-NG', {
    timeZone: 'Africa/Lagos',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return [
    `${covered ? ':bank:' : ':rotating_light:'} *Pool balance* · ${report.environment} · ${when}`,
    `• VFD pool account: *${naira(report.pool)}*`,
    `• Customer wallets (${report.customerCount}): *${naira(report.customers)}*`,
    covered
      ? `• Surplus: ${naira(surplus)}`
      : `• *UNDER-FUNDED by ${naira(surplus.abs())}* — the pool does not cover what customers hold`,
  ].join('\n');
}
