import { BillsService } from './bills.service';

// Only the parts the token flow touches are real; the rest are inert.
function setup(opts: { statusResult?: unknown; tx?: unknown }) {
  const queue = { add: jest.fn().mockResolvedValue(undefined) };
  const notifications = {
    notifyTransaction: jest.fn().mockResolvedValue(undefined),
    sendBillReceiptEmail: jest.fn().mockResolvedValue(undefined),
  };
  const transactionsRepo = {
    update: jest.fn().mockResolvedValue(undefined),
    findOneBy: jest.fn().mockResolvedValue(opts.tx ?? null),
  };
  const provider = {
    queryBillStatus: jest.fn().mockResolvedValue(opts.statusResult),
  };
  const registry = { getBillsProvider: () => provider };
  const wallets = { findById: jest.fn().mockResolvedValue({ userId: 'u1' }) };
  const beneficiaries = {
    recordSuccess: jest.fn().mockResolvedValue(undefined),
  };
  const service = new BillsService(
    transactionsRepo as never,
    {} as never,
    {} as never,
    wallets as never,
    {} as never,
    notifications as never,
    {} as never,
    registry as never,
    queue as never,
    {} as never,
    {} as never,
    beneficiaries as never,
  );
  return { service, queue, notifications, transactionsRepo, provider };
}

const bill = (token: string | null = null) => ({
  category: 'Utility',
  billerId: 'IKEDC',
  billerName: 'IKEJA Electricity',
  division: 'F',
  productId: '408',
  paymentItem: 'P',
  paymentItemName: 'prepaid',
  customerId: '45012345627',
  token,
});
const tx = (billType: string, token: string | null = null) => ({
  id: 't1',
  walletId: 'w1',
  amount: '2000',
  reference: 'ADL-B1',
  billType,
  bill: bill(token),
});
const result = (token: string | null) => ({
  outcome: 'SUCCESSFUL',
  providerStatusCode: '00',
  token,
  extraTokens: [],
  rawPayload: null,
});

type Internals = {
  markSuccessful(t: unknown, r: unknown): Promise<void>;
};

describe('electricity token flow', () => {
  it('sends the email at once when the token came back with the payment', async () => {
    const { service, notifications, queue } = setup({});
    await (service as unknown as Internals).markSuccessful(
      tx('UTILITY'),
      result('12345678901234567890'),
    );
    const [, , options] = notifications.notifyTransaction.mock.calls[0] as [
      unknown,
      unknown,
      { receiptEmail: boolean },
    ];
    expect(options.receiptEmail).toBe(true);
    expect(queue.add).not.toHaveBeenCalled();
    const [paid] = notifications.notifyTransaction.mock.calls[0] as [
      { bill: { token: string } },
    ];
    expect(paid.bill.token).toBe('12345678901234567890');
  });

  it('holds the email and queues a token fetch when an electricity token is not ready', async () => {
    const { service, notifications, queue } = setup({});
    await (service as unknown as Internals).markSuccessful(
      tx('UTILITY'),
      result(null),
    );
    const [, , options] = notifications.notifyTransaction.mock.calls[0] as [
      unknown,
      unknown,
      { receiptEmail: boolean },
    ];
    expect(options.receiptEmail).toBe(false);
    expect(queue.add).toHaveBeenCalledWith(
      'fetch-bill-token',
      expect.objectContaining({ transactionId: 't1' }),
      expect.objectContaining({ attempts: 6 }),
    );
  });

  it('does not hold the email for bills that normally have no token', async () => {
    for (const type of ['AIRTIME', 'DATA', 'INTERNET']) {
      const { service, notifications, queue } = setup({});
      await (service as unknown as Internals).markSuccessful(
        tx(type),
        result(null),
      );
      const [, , options] = notifications.notifyTransaction.mock.calls[0] as [
        unknown,
        unknown,
        { receiptEmail: boolean },
      ];
      expect(options.receiptEmail).toBe(true);
      expect(queue.add).not.toHaveBeenCalled();
    }
  });

  it('keeps retrying (throws) while the provider has not issued the token', async () => {
    const { service, notifications } = setup({
      tx: tx('UTILITY'),
      statusResult: result(null),
    });
    await expect(service.fetchTokenAndSendReceipt('t1')).rejects.toThrow(
      'not issued yet',
    );
    expect(notifications.sendBillReceiptEmail).not.toHaveBeenCalled();
  });

  it('stores the token and emails the receipt once it arrives', async () => {
    const { service, notifications, transactionsRepo } = setup({
      tx: tx('UTILITY'),
      statusResult: {
        ...result('12345678901234567890'),
        extraTokens: [{ label: 'Key change token 1', value: '1' }],
      },
    });
    await expect(service.fetchTokenAndSendReceipt('t1')).resolves.toBe('SENT');
    expect(transactionsRepo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({
        bill: expect.objectContaining({
          token: '12345678901234567890',
        }) as unknown,
      }),
    );
    const [sent] = notifications.sendBillReceiptEmail.mock.calls[0] as [
      { bill: { token: string; extraTokens: unknown[] } },
    ];
    expect(sent.bill.token).toBe('12345678901234567890');
    expect(sent.bill.extraTokens).toHaveLength(1);
  });

  it('emails straight away if the token was stored by the time the job runs', async () => {
    const { service, notifications, provider } = setup({
      tx: tx('UTILITY', '999'),
    });
    await service.fetchTokenAndSendReceipt('t1');
    expect(provider.queryBillStatus).not.toHaveBeenCalled();
    expect(notifications.sendBillReceiptEmail).toHaveBeenCalled();
  });

  it('after the last attempt, sends the receipt with a missing-token note', async () => {
    const { service, notifications } = setup({ tx: tx('UTILITY') });
    await service.sendReceiptWithoutToken('t1');
    expect(notifications.sendBillReceiptEmail).toHaveBeenCalledWith(
      expect.anything(),
      { tokenMissing: true },
    );
  });
});
