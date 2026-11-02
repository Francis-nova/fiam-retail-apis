/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- jest mocks are untyped by design */
import { PayoutsService } from './payouts.service';
import {
  Transaction,
  TransactionKind,
  TransactionStatus,
  TransactionType,
} from '../transactions/entities/transaction.entity';

// A failed payout must give back everything the customer paid: the amount,
// the fee, the VAT on it and the stamp duty. `fee` is that total.
function make(txn: Partial<Transaction> | null) {
  const saved: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const manager = {
    findOne: jest.fn().mockResolvedValue(txn),
    update: jest.fn((_e, _id, patch) => updated.push(patch)),
    create: jest.fn((_e, row) => row),
    save: jest.fn((_e, row) => saved.push(row)),
  };
  const credit = jest.fn().mockResolvedValue({ balance: '99999.0000' });
  const svc = Object.create(PayoutsService.prototype) as Record<
    string,
    unknown
  >;
  Object.assign(svc, {
    dataSource: { transaction: (cb: (m: unknown) => unknown) => cb(manager) },
    walletsService: { creditForUpdate: credit },
    notifications: { notifyTransaction: jest.fn() },
    logger: { warn: jest.fn() },
  });
  return { svc: svc as unknown as PayoutsService, credit, saved, updated };
}

const payout = (over: Partial<Transaction> = {}): Partial<Transaction> => ({
  id: 't1',
  walletId: 'w1',
  status: TransactionStatus.PROCESSING,
  amount: '15000.0000',
  // ₦25 fee + ₦1.88 VAT + ₦50 stamp duty
  fee: '76.8800',
  currency: 'NGN' as Transaction['currency'],
  provider: 'VFD' as Transaction['provider'],
  reference: 'ADL1',
  ...over,
});

describe('PayoutsService.reverseFailedPayout', () => {
  it('refunds amount + fee (including VAT and stamp duty) and marks it FAILED', async () => {
    const { svc, credit, saved, updated } = make(payout());
    await svc.reverseFailedPayout('t1');
    expect(credit.mock.calls[0][2].toFixed(4)).toBe('15076.8800');
    expect(updated[0]).toMatchObject({ status: TransactionStatus.FAILED });
    expect(saved[0]).toMatchObject({
      type: TransactionType.CREDIT,
      kind: TransactionKind.REVERSAL,
      amount: '15076.8800',
      reference: 'REV-ADL1',
    });
  });

  it('refunds only the amount for a free payout under ₦10,000 (no fee)', async () => {
    const { svc, credit } = make(
      payout({ amount: '5000.0000', fee: '0.0000' }),
    );
    await svc.reverseFailedPayout('t1');
    expect(credit.mock.calls[0][2].toFixed(4)).toBe('5000.0000');
  });

  it('treats a missing fee (older rows) as zero', async () => {
    const { svc, credit } = make(payout({ fee: null }));
    await svc.reverseFailedPayout('t1');
    expect(credit.mock.calls[0][2].toFixed(4)).toBe('15000.0000');
  });

  it.each([TransactionStatus.FAILED, TransactionStatus.SUCCESSFUL])(
    'does nothing twice: an already %s payout is not refunded again',
    async (status) => {
      const { svc, credit, saved } = make(payout({ status }));
      await svc.reverseFailedPayout('t1');
      expect(credit).not.toHaveBeenCalled();
      expect(saved).toHaveLength(0);
    },
  );
});
