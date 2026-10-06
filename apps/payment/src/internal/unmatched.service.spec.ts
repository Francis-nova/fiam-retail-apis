/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await -- jest mocks are untyped by design */
import { UnmatchedService } from './unmatched.service';

const WALLET = '11111111-1111-4111-8111-111111111111';
const dto = {
  walletId: WALLET,
  reference: 'MAN-p1',
  meta: { approvedBy: 'c@fiam.ng' },
};

function txn(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    type: 'CREDIT',
    status: 'UNMATCHED',
    walletId: null,
    currency: 'NGN',
    amount: '7500.0000',
    rawPayload: { provider: 'x' },
    balanceAfter: null,
    ...over,
  };
}

function make(t: ReturnType<typeof txn> | null, walletCurrency = 'NGN') {
  const update = jest.fn().mockResolvedValue({});
  const manager = {
    createQueryBuilder: () => ({
      setLock: () => ({ where: () => ({ getOne: async () => t }) }),
    }),
    update,
    findOneByOrFail: jest.fn().mockImplementation(async () => ({
      ...t,
      status: 'SUCCESSFUL',
      walletId: WALLET,
      balanceAfter: '8500.0000',
    })),
  };
  const dataSource = {
    transaction: (fn: (m: unknown) => unknown) => fn(manager),
  };
  const creditForUpdate = jest.fn().mockResolvedValue({
    id: WALLET,
    currency: walletCurrency,
    balance: '8500.0000',
  });
  const notify = jest.fn().mockResolvedValue(undefined);
  const svc = new UnmatchedService(
    dataSource as never,
    { creditForUpdate } as never,
    { notifyTransaction: notify } as never,
  );
  return { svc, update, creditForUpdate, notify };
}

describe('UnmatchedService.assign', () => {
  it('credits the wallet once, turns the same row into the wallet credit, and tells the customer', async () => {
    const { svc, update, creditForUpdate, notify } = make(txn());
    const res = await svc.assign('t1', dto);
    expect(creditForUpdate).toHaveBeenCalledTimes(1);
    expect(creditForUpdate.mock.calls[0][1]).toBe(WALLET);
    expect(String(creditForUpdate.mock.calls[0][2])).toBe('7500');
    expect(update).toHaveBeenCalledWith(
      expect.anything(),
      't1',
      expect.objectContaining({
        walletId: WALLET,
        status: 'SUCCESSFUL',
        balanceAfter: '8500.0000',
      }),
    );
    // The provider's own payload survives, with the resolution added.
    const payload = update.mock.calls[0][2].rawPayload;
    expect(payload.provider).toBe('x');
    expect(payload.resolution).toMatchObject({
      reference: 'MAN-p1',
      approvedBy: 'c@fiam.ng',
    });
    expect(res).toMatchObject({ replayed: false, status: 'SUCCESSFUL' });
    expect(notify).toHaveBeenCalledWith(expect.anything(), 'CREDIT_RECEIVED');
  });

  it('is idempotent: a retry after the credit landed credits nothing more', async () => {
    const { svc, creditForUpdate, notify } = make(
      txn({ status: 'SUCCESSFUL', walletId: WALLET }),
    );
    const res = await svc.assign('t1', dto);
    expect(res.replayed).toBe(true);
    expect(creditForUpdate).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it.each([
    [
      'already assigned to a different wallet',
      { status: 'SUCCESSFUL', walletId: 'other' },
    ],
    ['a payout (debit)', { type: 'DEBIT' }],
    ['a normal pending payin', { status: 'PENDING' }],
    ['already failed', { status: 'FAILED' }],
  ])('refuses %s without touching any wallet', async (_n, over) => {
    const { svc, creditForUpdate } = make(txn(over));
    await expect(svc.assign('t1', dto)).rejects.toMatchObject({ status: 409 });
    expect(creditForUpdate).not.toHaveBeenCalled();
  });

  it('404s an unknown transaction', async () => {
    const { svc } = make(null);
    await expect(svc.assign('nope', dto)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('refuses a wallet in another currency (the DB transaction rolls the credit back)', async () => {
    const { svc, update } = make(txn(), 'USD');
    await expect(svc.assign('t1', dto)).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });
});
