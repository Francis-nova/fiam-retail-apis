import { NotificationsService } from './notifications.service';

function setup() {
  const emitted: { pattern: string; data: Record<string, unknown> }[] = [];
  const client = {
    emit: jest.fn((pattern: string, payload: unknown) => {
      const record = (payload as { getData?: () => unknown })?.getData
        ? (payload as { getData: () => Record<string, unknown> }).getData()
        : (payload as Record<string, unknown>);
      emitted.push({ pattern, data: record });
    }),
  };
  const wallets = {
    findById: jest.fn().mockResolvedValue({ id: 'w1', userId: 'u1' }),
  };
  const config = {
    get: () => ({ internalUrl: 'http://auth', internalApiKey: 'k' }),
  };
  const slack = { transaction: jest.fn() };
  const service = new NotificationsService(
    client as never,
    wallets as never,
    config as never,
    slack as never,
  );
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ email: 'ada@example.com', firstName: 'Ada' }),
  }) as never;
  const emails = () =>
    emitted.filter(
      (e) => e.data.channel === 'EMAIL' || e.data.channel === 'email',
    );
  return { service, emitted, emails };
}

const bill = {
  category: 'Utility',
  billerId: 'IKEDC',
  billerName: 'IKEJA Electricity',
  division: 'F',
  productId: '408',
  paymentItem: 'IKEDC_PREPAID',
  paymentItemName: 'Ikeja Electric prepaid',
  customerId: '45012345627',
  token: null as string | null,
};
const tx = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  walletId: 'w1',
  amount: '2000.0000',
  fee: '100.0000',
  reference: 'ADL-B1',
  billType: 'UTILITY',
  bill,
  createdAt: new Date('2026-10-16T20:17:00Z'),
  ...over,
});

describe('bill receipt email', () => {
  const realFetch = global.fetch;
  afterAll(() => {
    global.fetch = realFetch;
  });

  it('uses the bill template, not the bank-transfer one, and carries the token', async () => {
    const { service, emails } = setup();
    await service.sendBillReceiptEmail(
      tx({ bill: { ...bill, token: '12345678901234567890' } }) as never,
    );
    const [email] = emails();
    expect(email.data.template).toBe('bill-receipt');
    const d = email.data.data as Record<string, string>;
    expect(d).toMatchObject({
      billTypeLabel: 'Electricity',
      customerLabel: 'Meter number',
      biller: 'IKEJA Electricity',
      plan: 'Ikeja Electric prepaid',
      paidFor: '45012345627',
      amount: '₦2,000.00',
      fee: '₦100.00',
      total: '₦2,100.00',
      hasToken: 'true',
      token: '1234 5678 9012 3456 7890',
      reference: 'ADL-B1',
    });
    expect(d.tokenMissing).toBeUndefined();
  });

  it('adds key change tokens in order', async () => {
    const { service, emails } = setup();
    await service.sendBillReceiptEmail(
      tx({
        bill: {
          ...bill,
          token: '33333333',
          extraTokens: [
            { label: 'Key change token 1', value: '11111111' },
            { label: 'Key change token 2', value: '22222222' },
          ],
        },
      }) as never,
    );
    const d = emails()[0].data.data as Record<string, string>;
    expect(d.extra1Label).toBe('Key change token 1');
    expect(d.extra1).toBe('11111111');
    expect(d.extra2).toBe('22222222');
  });

  it('flags a missing token, and leaves out the fee row when there is none', async () => {
    const { service, emails } = setup();
    await service.sendBillReceiptEmail(tx({ fee: '0.0000' }) as never, {
      tokenMissing: true,
    });
    const d = emails()[0].data.data as Record<string, string>;
    expect(d.tokenMissing).toBe('true');
    expect(d.hasToken).toBeUndefined();
    expect(d.fee).toBeUndefined();
    expect(d.total).toBe('₦2,000.00');
  });

  it('notifyTransaction sends a bill receipt for a bill and none when held back', async () => {
    const a = setup();
    await a.service.notifyTransaction(
      tx({ bill: { ...bill, token: '99999999' } }) as never,
      'PAYOUT_SUCCESSFUL',
    );
    expect(a.emails().map((e) => e.data.template)).toEqual(['bill-receipt']);

    const b = setup();
    await b.service.notifyTransaction(tx() as never, 'PAYOUT_SUCCESSFUL', {
      receiptEmail: false,
    });
    expect(b.emails()).toHaveLength(0);
    // the push still goes out
    expect(b.emitted.length).toBeGreaterThan(0);
  });

  it('still sends the transfer receipt for an ordinary payout', async () => {
    const { service, emails } = setup();
    await service.notifyTransaction(
      {
        id: 't2',
        walletId: 'w1',
        amount: '500',
        reference: 'R',
        accountNumber: '0123456789',
      },
      'PAYOUT_SUCCESSFUL',
    );
    expect(emails()[0].data.template).toBe('transaction-receipt');
  });
});
