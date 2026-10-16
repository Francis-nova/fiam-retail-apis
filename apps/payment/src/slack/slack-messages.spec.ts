import Decimal from 'decimal.js';
import {
  TransactionKind,
  TransactionType,
  BillType,
} from '../transactions/entities/transaction.entity';
import {
  naira,
  poolBalanceMessage,
  transactionMessage,
} from './slack-messages';

const ctx = { environment: 'production', userId: 'u-1' };

describe('naira', () => {
  it('formats with thousands separators and two decimals', () => {
    expect(naira('1234567.5')).toBe('₦1,234,567.50');
    expect(naira(0)).toBe('₦0.00');
    expect(naira(new Decimal('-2500'))).toBe('-₦2,500.00');
    expect(naira('9000.0000')).toBe('₦9,000.00');
  });
});

describe('transactionMessage', () => {
  it('describes a successful deposit', () => {
    const text = transactionMessage(
      {
        type: TransactionType.CREDIT,
        kind: TransactionKind.DEPOSIT,
        amount: '9000.0000',
        reference: 'R1',
      },
      'SUCCESSFUL',
      ctx,
    );
    expect(text).toContain(':white_check_mark:');
    expect(text).toContain('Deposit');
    expect(text).toContain('successful');
    expect(text).toContain('₦9,000.00');
    expect(text).toContain('reference: R1');
    expect(text).toContain('user: u-1');
    expect(text).toContain('production');
    expect(text).not.toContain('refunded');
  });

  it('names the bill type and biller, and shows a fee only when there is one', () => {
    const base = {
      type: TransactionType.DEBIT,
      kind: TransactionKind.BILL_PAYMENT,
      billType: BillType.UTILITY,
      amount: '2000.0000',
      bill: { billerName: 'IKEJA Electricity' } as never,
    };
    const withFee = transactionMessage(
      { ...base, fee: '100.0000' },
      'SUCCESSFUL',
      ctx,
    );
    expect(withFee).toContain('Bill payment · UTILITY · IKEJA Electricity');
    expect(withFee).toContain('fee: ₦100.00');
    expect(
      transactionMessage({ ...base, fee: '0.0000' }, 'SUCCESSFUL', ctx),
    ).not.toContain('fee:');
  });

  it('shows the provider code and message on a failure, and that the customer was refunded', () => {
    const text = transactionMessage(
      {
        type: TransactionType.DEBIT,
        kind: TransactionKind.BILL_PAYMENT,
        billType: BillType.UTILITY,
        amount: '2000.0000',
        providerStatusCode: '99',
        rawPayload: { message: 'Not in the recent documentation' },
      },
      'FAILED',
      ctx,
    );
    expect(text).toContain(':x:');
    expect(text).toContain('FAILED');
    expect(text).toContain('provider code: 99');
    expect(text).toContain('provider message: Not in the recent documentation');
    expect(text).toContain('the customer was refunded');
  });

  it('never prints account numbers, customer ids or narration', () => {
    const text = transactionMessage(
      {
        type: TransactionType.DEBIT,
        kind: TransactionKind.PAYOUT,
        amount: '500',
        reference: 'R2',
        bill: { customerId: '45012345627', billerName: 'X' } as never,
        rawPayload: {
          toAccount: '0123456789',
          originator_account_name: 'Ada Obi',
        },
      },
      'SUCCESSFUL',
      ctx,
    );
    for (const secret of ['45012345627', '0123456789', 'Ada Obi']) {
      expect(text).not.toContain(secret);
    }
  });

  it('labels manual adjustments by direction', () => {
    expect(
      transactionMessage(
        {
          type: TransactionType.DEBIT,
          kind: TransactionKind.ADJUSTMENT,
          amount: '10',
        },
        'SUCCESSFUL',
        ctx,
      ),
    ).toContain('Manual adjustment (debit)');
  });
});

describe('poolBalanceMessage', () => {
  const at = new Date('2026-10-16T10:00:00Z');
  const base = { customerCount: 12, environment: 'production', at };

  it('shows the pool, the customers total and the surplus when covered', () => {
    const text = poolBalanceMessage({
      ...base,
      pool: new Decimal('1500000'),
      customers: new Decimal('1200000.5'),
    });
    expect(text).toContain(':bank:');
    expect(text).toContain('VFD pool account: *₦1,500,000.00*');
    expect(text).toContain('Customer wallets (12): *₦1,200,000.50*');
    expect(text).toContain('Surplus: ₦299,999.50');
    expect(text).not.toContain('UNDER-FUNDED');
  });

  it('raises the alarm when the pool does not cover what customers hold', () => {
    const text = poolBalanceMessage({
      ...base,
      pool: new Decimal('1000'),
      customers: new Decimal('4000'),
    });
    expect(text).toContain(':rotating_light:');
    expect(text).toContain('UNDER-FUNDED by ₦3,000.00');
  });

  it('treats exactly equal as covered', () => {
    const text = poolBalanceMessage({
      ...base,
      pool: new Decimal('100'),
      customers: new Decimal('100'),
    });
    expect(text).not.toContain('UNDER-FUNDED');
  });
});
