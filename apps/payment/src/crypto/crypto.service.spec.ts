import Decimal from 'decimal.js';
import { BadRequestException } from '@nestjs/common';
import { CurrencyCode } from '@app/common';
import { CryptoService, normaliseAddress } from './crypto.service';
import { PaymentProviderKey } from '../wallets/entities/address.entity';
import { StableStackClient } from './stablestack.client';

const compliance = {
  accountPurpose: 'PROTECT_WEALTH',
  sourceOfFunds: 'SALARY',
  employmentStatus: 'EMPLOYED',
  occupation: '151251',
  expectedMonthlyIncome: 1_000_000,
  acceptedRiskDisclosure: true,
} as const;

function setup(
  tier = 'TIER_3',
  existingCustomer: unknown = null,
  homeAddress: unknown = {
    address: '12 Allen Avenue',
    lga: 'Ikeja',
    state: 'Lagos',
  },
) {
  const config = {
    get: (key: string) =>
      key === 'auth'
        ? { internalUrl: 'http://auth', internalApiKey: 'k' }
        : key === 'stablestack.ngnMarkupPercent'
          ? '1'
          : key === 'stablestack.ngnPool'
            ? {
                accountNumber: '1035401629',
                bankCode: '090110',
                bankName: 'VFD Microfinance Bank',
                accountName: 'Fiam Pool',
              }
            : undefined,
  };
  const client = {
    createCustomer: jest.fn().mockResolvedValue('cus-1'),
    createWallet: jest.fn().mockResolvedValue({
      id: 'ssw-1',
      address: '0xAbC123',
      network: 'polygon',
    }),
    ngnRate: jest.fn().mockResolvedValue(new Decimal('1550')),
    isValidAddress: jest.fn().mockResolvedValue(true),
    withdrawalFees: jest.fn().mockResolvedValue({
      platform: new Decimal('0.2'),
      network: new Decimal('1'),
      fiam: new Decimal('1'),
    }),
    createWithdrawal: jest
      .fn()
      .mockResolvedValue({ transaction_id: 'TXOUT', status: 'PENDING' }),
    getTransaction: jest.fn(),
    createBankPayout: jest
      .fn()
      .mockResolvedValue({ transaction_id: 'TXBANK', status: 'PENDING' }),
    updateCustomer: jest.fn().mockResolvedValue(undefined),
  };
  const wallet = { id: 'w-1', balance: '0.00000000' };
  const walletsService = {
    getOrCreateWallet: jest.fn().mockResolvedValue(wallet),
    findByUserAndCurrency: jest.fn().mockResolvedValue(wallet),
    debitForUpdate: jest.fn().mockResolvedValue({ balance: '0.00000000' }),
    creditForUpdate: jest.fn().mockResolvedValue({ balance: '15345.00000000' }),
  };
  let active: unknown = null;
  const addressService = {
    findActiveForWallet: jest.fn(() => Promise.resolve(active)),
    insertActiveAddress: jest.fn(
      (
        walletId: string,
        account: { accountNumber: string; metadata: unknown },
      ) => {
        active = {
          providerAccountNumber: account.accountNumber,
          providerMetadata: account.metadata,
        };
        return Promise.resolve(active);
      },
    ),
  };
  const transactionsService = {
    recordPayin: jest.fn<Promise<void>, [{ amount: Decimal }]>(),
  };
  const runner = {
    connect: jest.fn(),
    query: jest.fn().mockResolvedValue([]),
    release: jest.fn(),
  };
  const saved: Record<string, unknown>[] = [];
  const manager = {
    create: (_e: unknown, v: Record<string, unknown>) => v,
    save: (_e: unknown, v: Record<string, unknown>) => {
      saved.push(v);
      return Promise.resolve({ id: 't-1', ...v });
    },
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const dataSource = {
    createQueryRunner: () => runner,
    transaction: (cb: (m: typeof manager) => unknown) => cb(manager),
  };
  let customer: unknown = existingCustomer;
  const customers = {
    findOneBy: jest.fn(() => Promise.resolve(customer)),
    create: (v: unknown) => v,
    save: jest.fn((v: unknown) => Promise.resolve((customer = v))),
  };
  const webhookEvents = { create: (v: unknown) => v, save: jest.fn() };
  const withdrawal = {
    id: 't-1',
    status: 'PROCESSING',
    rawPayload: { quote: {} },
  };
  const transactions = {
    findOneBy: jest.fn().mockResolvedValue(withdrawal),
    findOneByOrFail: jest.fn().mockResolvedValue(withdrawal),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
  const payoutsService = {
    reverseFailedPayout: jest.fn(),
    assertWithinTransferLimit: jest.fn(),
  };
  const pinVerifier = {
    assertValid: jest.fn().mockResolvedValue({ transferLimit: null }),
  };
  const notifications = { notifyTransaction: jest.fn() };
  const statusQueue = { add: jest.fn() };

  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Okafor',
        tier,
        dateOfBirth: '1990-05-01',
        phone: '2348012345678',
        homeAddress,
      }),
  }) as never;

  const service = new CryptoService(
    config as never,
    client as never,
    walletsService as never,
    addressService as never,
    transactionsService as never,
    dataSource as never,
    customers as never,
    webhookEvents as never,
    transactions as never,
    payoutsService as never,
    pinVerifier as never,
    notifications as never,
    statusQueue as never,
  );
  return {
    service,
    client,
    transactionsService,
    runner,
    saved,
    transactions,
    payoutsService,
    pinVerifier,
    statusQueue,
    walletsService,
    manager,
    notifications,
  };
}

describe('CryptoService.createWallet', () => {
  it('creates the customer and wallet once, then returns the same address', async () => {
    const { service, client, runner } = setup();
    const dto = { currency: CurrencyCode.USDC as const, compliance };

    const first = await service.createWallet('u-1', dto);
    const second = await service.createWallet('u-1', dto);

    expect(first).toEqual({
      currency: 'USDC',
      balance: '0.00000000',
      network: 'polygon',
      address: '0xabc123',
    });
    expect(second).toEqual(first);
    expect(client.createCustomer).toHaveBeenCalledTimes(1);
    expect(client.createWallet).toHaveBeenCalledWith({
      customerId: 'cus-1',
      currency: 'USDC',
      network: 'polygon',
    });
    expect(client.createWallet).toHaveBeenCalledTimes(1);
    expect(runner.release).toHaveBeenCalledTimes(2);
  });

  it('refuses Tier 1 customers', async () => {
    const { service, client } = setup('TIER_1');
    await expect(
      service.createWallet('u-1', {
        currency: CurrencyCode.USDC,
        compliance,
      } as never),
    ).rejects.toThrow('Upgrade your account');
    expect(client.createCustomer).not.toHaveBeenCalled();
  });

  it('needs the compliance answers for a new customer', async () => {
    const { service, client } = setup();
    await expect(
      service.createWallet('u-1', { currency: CurrencyCode.USDC } as never),
    ).rejects.toThrow('answer the questions');
    expect(client.createWallet).not.toHaveBeenCalled();
  });
});

describe('CryptoService.handleWebhook', () => {
  const inbound = (data: Record<string, unknown>) => ({
    id: 'evt_1',
    event_type: 'wallet.transaction.inbound',
    data: {
      status: 'COMPLETED',
      asset_code: 'USDC',
      amount: '20.00000000',
      transaction_id: 'TX123',
      crypto_transaction_id: '0xhash',
      created_at: '2026-11-17T10:00:00.000Z',
      receiver_wallet_details: { address: '0xAbC123', network: 'polygon' },
      ...data,
    },
  });

  it('records a completed deposit against the address', async () => {
    const { service, transactionsService } = setup();
    await service.handleWebhook(inbound({}));
    const [input] = transactionsService.recordPayin.mock.calls[0];
    expect(input).toMatchObject({
      provider: PaymentProviderKey.STABLESTACK,
      currency: 'USDC',
      accountNumber: '0xabc123',
      reference: 'TX123',
      externalId: '0xhash',
    });
    expect(input.amount.toString()).toBe('20');
  });

  it('ignores deposits that are not completed, and other events', async () => {
    const { service, transactionsService } = setup();
    await service.handleWebhook(inbound({ status: 'PENDING' }));
    await service.handleWebhook({
      id: 'evt_2',
      event_type: 'payout.completed',
    });
    expect(transactionsService.recordPayin).not.toHaveBeenCalled();
  });
});

describe('CryptoService.ngnRate', () => {
  it("takes Fiam's markup off StableStack's rate", async () => {
    const { service } = setup();
    await expect(service.ngnRate()).resolves.toEqual({ ngnPerUsd: '1534.50' });
  });
});

describe('normaliseAddress', () => {
  it('lower-cases EVM addresses only', () => {
    expect(normaliseAddress('0xAbC')).toBe('0xabc');
    expect(normaliseAddress('TXvzrLA94eB1')).toBe('TXvzrLA94eB1');
  });
});

const ssCustomer = { userId: 'u-1', stablestackCustomerId: 'cus-1' };
const send = {
  pin: '1234',
  currency: CurrencyCode.USDC as const,
  amount: '100',
  address: '0xDeF4567890abcdef4567890abcdef4567890abcd',
};

describe('CryptoService withdrawals', () => {
  it('quotes every fee out of the amount', async () => {
    const { service } = setup('TIER_3', ssCustomer);
    await expect(
      service.quoteWithdrawal('u-1', CurrencyCode.USDC, '100'),
    ).resolves.toEqual({
      currency: 'USDC',
      network: 'polygon',
      amount: '100.00000000',
      platformFee: '0.20000000',
      networkFee: '1.00000000',
      fiamFee: '1.00000000',
      totalFee: '2.20000000',
      recipientReceives: '97.80000000',
    });
  });

  it('quotes on the network the customer picked', async () => {
    const { service, client } = setup('TIER_3', ssCustomer);
    const q = await service.quoteWithdrawal(
      'u-1',
      CurrencyCode.USDT,
      '100',
      '0xDeF4567890abcdef4567890abcdef4567890abcd',
      'bep20',
    );
    expect(q.network).toBe('bep20');
    expect(client.withdrawalFees).toHaveBeenCalledWith(
      expect.objectContaining({ network: 'bep20' }),
    );
  });

  it("refuses a network the coin doesn't support", async () => {
    const { service } = setup('TIER_3', ssCustomer);
    await expect(
      service.quoteWithdrawal(
        'u-1',
        CurrencyCode.USDC,
        '100',
        undefined,
        'trc20',
      ),
    ).rejects.toThrow("USDC can't be sent on trc20");
  });

  it('refuses an address from another network', async () => {
    const { service, client } = setup('TIER_3', ssCustomer);
    await expect(
      service.quoteWithdrawal(
        'u-1',
        CurrencyCode.USDT,
        '100',
        'TQn9Y2khEsLJW1ChVWFMSMeRDow5Kcbk8h',
        'erc20',
      ),
    ).rejects.toThrow("That address isn't on ERC-20");
    await expect(
      service.quoteWithdrawal(
        'u-1',
        CurrencyCode.USDT,
        '100',
        'TQn9Y2khEsLJW1ChVWFMSMeRDow5Kcbk8h',
        'trc20',
      ),
    ).resolves.toMatchObject({ network: 'trc20' });
    expect(client.isValidAddress).toHaveBeenCalledTimes(1);
  });

  it('refuses an amount the fees would swallow', async () => {
    const { service } = setup('TIER_3', ssCustomer);
    await expect(
      service.quoteWithdrawal('u-1', CurrencyCode.USDC, '2'),
    ).rejects.toThrow('The fees are 2.20 USDC');
  });

  it('holds the full amount, sends it, and swaps in their transaction id', async () => {
    const { service, client, saved, transactions, statusQueue, pinVerifier } =
      setup('TIER_3', ssCustomer);
    await service.withdraw('u-1', send);

    expect(pinVerifier.assertValid).toHaveBeenCalledWith('u-1', '1234');
    expect(saved[0]).toMatchObject({
      status: 'PROCESSING',
      kind: 'PAYOUT',
      accountNumber: '0xdef4567890abcdef4567890abcdef4567890abcd',
      amount: '97.80000000',
      fee: '2.20000000',
    });
    const [[sent]] = client.createWithdrawal.mock.calls as [
      [{ amount: Decimal }],
    ];
    expect(sent.amount.toString()).toBe('100');
    expect(transactions.update).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({ reference: 'TXOUT' }),
    );
    expect(statusQueue.add).toHaveBeenCalled();
  });

  it('keeps the quote (with ngnValue for the cap) after swapping in their id', async () => {
    const { service, transactions, pinVerifier } = setup('TIER_3', ssCustomer);
    pinVerifier.assertValid.mockResolvedValue({
      transferLimit: { amount: '20000.00', since: 'x', until: 'y' },
    });
    await service.withdraw('u-1', send);
    const [[, patch]] = transactions.update.mock.calls as [
      [
        string,
        { rawPayload: { quote: { ngnValue: string }; created: unknown } },
      ],
    ];
    expect(patch.rawPayload.quote.ngnValue).toBe('153450.00');
    expect(patch.rawPayload.created).toBeDefined();
  });

  it('checks the new-device cap in naira while it applies', async () => {
    const { service, payoutsService, pinVerifier, saved } = setup(
      'TIER_3',
      ssCustomer,
    );
    const limit = { amount: '20000.00', since: 'x', until: 'y' };
    pinVerifier.assertValid.mockResolvedValue({ transferLimit: limit });
    await service.withdraw('u-1', send);
    // 100 USDC at 1534.50 (StableStack 1550 less our 1%).
    const [[, user, ngnWalletId, ngn, passed]] = payoutsService
      .assertWithinTransferLimit.mock.calls as [
      [unknown, string, string, Decimal, unknown],
    ];
    expect([user, ngnWalletId, ngn.toString(), passed]).toEqual([
      'u-1',
      'w-1',
      '153450',
      limit,
    ]);
    expect(saved[0]).toMatchObject({
      rawPayload: { quote: { ngnValue: '153450.00' } },
    });
  });

  it('refunds when StableStack refuses the withdrawal', async () => {
    const { service, client, payoutsService } = setup('TIER_3', ssCustomer);
    client.createWithdrawal.mockRejectedValue(new BadRequestException('no'));
    await expect(service.withdraw('u-1', send)).rejects.toThrow('no');
    expect(payoutsService.reverseFailedPayout).toHaveBeenCalledWith('t-1');
  });

  it('settles from the outbound webhook', async () => {
    const { service, transactions, payoutsService } = setup();
    const outbound = (status: string) => ({
      id: 'evt_3',
      event_type: 'wallet.transaction.outbound',
      data: { transaction_id: 'TXOUT', status, crypto_transaction_id: '0xh' },
    });

    await service.handleWebhook(outbound('COMPLETED'));
    expect(transactions.update).toHaveBeenCalledWith(
      { id: 't-1', status: 'PROCESSING' },
      expect.objectContaining({
        status: 'SUCCESSFUL',
        rawPayload: { quote: {}, cryptoTransactionId: '0xh' },
      }),
    );

    await service.handleWebhook(outbound('FAILED'));
    expect(payoutsService.reverseFailedPayout).toHaveBeenCalledWith('t-1');
  });
});

describe('StableStackClient.withdrawalFees', () => {
  it('reads the platform %, network fee and our merchant fee', async () => {
    const client = new StableStackClient({
      get: () => ({ baseUrl: 'http://ss', apiKey: 'k' }),
    } as never);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          data: {
            fees: { fee_type: 'percentage', fee_value: '0.2000' },
            otherFee: { fee: '1.00' },
            merchant_fee: { amount: '1.000000' },
          },
        }),
    }) as never;
    const fees = await client.withdrawalFees({
      customerId: 'cus-1',
      currency: 'USDC',
      network: 'polygon',
      amount: new Decimal('123.456789'),
    });
    expect(fees.platform.toString()).toBe('0.246913');
    expect(fees.network.toString()).toBe('1');
    expect(fees.fiam.toString()).toBe('1');
  });
});

describe('CryptoService conversions', () => {
  const ssCustomer = {
    userId: 'u-1',
    stablestackCustomerId: 'cus-1',
    compliance,
  };
  const sell = { pin: '1234', currency: CurrencyCode.USDT, amount: '10' } as {
    pin: string;
    currency: CurrencyCode.USDT;
    amount: string;
  };

  it('quotes naira at our rate for that coin', async () => {
    const { service, client } = setup();
    await expect(
      service.quoteConversion(CurrencyCode.USDT, '10.5'),
    ).resolves.toEqual({
      currency: 'USDT',
      amount: '10.50000000',
      rate: '1534.50',
      ngnAmount: '16112.25',
    });
    expect(client.ngnRate).toHaveBeenCalledWith('USDT');
  });

  it('refuses less than the minimum', async () => {
    const { service } = setup();
    await expect(
      service.quoteConversion(CurrencyCode.USDC, '9.99'),
    ).rejects.toThrow('The minimum is 10 USDC.');
  });

  it('holds the coin and asks StableStack to pay naira into the pool', async () => {
    const { service, client, saved, pinVerifier, transactions } = setup(
      'TIER_3',
      ssCustomer,
    );
    await service.convert('u-1', sell);
    expect(pinVerifier.assertValid).toHaveBeenCalledWith('u-1', '1234');
    expect(saved[0]).toMatchObject({
      kind: 'CONVERSION',
      type: 'DEBIT',
      status: 'PROCESSING',
      amount: '10.00000000',
      accountNumber: '1035401629',
      rawPayload: { conversion: { ngnAmount: '15345.00', ngnWalletId: 'w-1' } },
    });
    expect(client.createBankPayout).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus-1',
        currency: 'USDT',
        accountNumber: '1035401629',
        bankCode: '090110',
      }),
    );
    expect(transactions.update).toHaveBeenCalledWith(
      't-1',
      expect.objectContaining({ reference: 'TXBANK' }),
    );
  });

  it('sends StableStack the full customer profile first', async () => {
    const { service, client } = setup('TIER_3', ssCustomer);
    await service.convert('u-1', sell);
    expect(client.updateCustomer).toHaveBeenCalledWith('cus-1', {
      birth_date: '1990-05-01',
      phone: '+2348012345678',
      account_purpose: 'PROTECT_WEALTH',
      source_of_funds: 'SALARY',
      employment_status: 'EMPLOYED',
      most_recent_occupation: '151251',
      expected_monthly_income: 1_000_000,
      address: {
        line_1: '12 Allen Avenue',
        city: 'Ikeja',
        state: 'Lagos',
        country: 'NG',
      },
    });
  });

  it('refuses before moving money when there is no address', async () => {
    const { service, client, saved } = setup('TIER_3', ssCustomer, null);
    await expect(service.convert('u-1', sell)).rejects.toThrow(
      'Add your home address to convert.',
    );
    expect(saved).toHaveLength(0);
    expect(client.createBankPayout).not.toHaveBeenCalled();
  });

  it('credits the naira wallet once when StableStack completes it', async () => {
    const {
      service,
      transactions,
      walletsService,
      manager,
      saved,
      notifications,
    } = setup();
    const conversion = {
      id: 't-9',
      kind: 'CONVERSION',
      currency: 'USDT',
      reference: 'TXBANK',
      status: 'PROCESSING',
      rawPayload: {
        conversion: { ngnAmount: '15345.00', ngnWalletId: 'w-ngn' },
      },
    };
    transactions.findOneBy.mockResolvedValue(conversion);
    const completed = {
      id: 'evt_9',
      event_type: 'payout.completed',
      data: { transaction_id: 'TXBANK' },
    };

    await service.handleWebhook(completed);
    expect(manager.update).toHaveBeenCalledWith(
      expect.anything(),
      { id: 't-9', status: 'PROCESSING' },
      expect.objectContaining({ status: 'SUCCESSFUL' }),
    );
    const [[, walletId, amount]] = walletsService.creditForUpdate.mock
      .calls as [[unknown, string, Decimal]];
    expect([walletId, amount.toString()]).toEqual(['w-ngn', '15345']);
    expect(saved.at(-1)).toMatchObject({
      walletId: 'w-ngn',
      currency: 'NGN',
      type: 'CREDIT',
      kind: 'CONVERSION',
      amount: '15345.00',
      reference: 'TXBANK-NGN',
    });
    expect(notifications.notifyTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ walletId: 'w-ngn' }),
      'CREDIT_RECEIVED',
    );

    // A second report (status job or repeat webhook) moves nothing.
    manager.update.mockResolvedValue({ affected: 0 });
    await service.handleWebhook(completed);
    expect(walletsService.creditForUpdate).toHaveBeenCalledTimes(1);
  });

  it('refunds the coin when the naira payout fails', async () => {
    const { service, transactions, payoutsService } = setup();
    transactions.findOneBy.mockResolvedValue({
      id: 't-9',
      kind: 'CONVERSION',
      status: 'PROCESSING',
    });
    await service.handleWebhook({
      id: 'evt_10',
      event_type: 'payout.failed',
      data: { transaction_id: 'TXBANK' },
    });
    expect(payoutsService.reverseFailedPayout).toHaveBeenCalledWith('t-9');
  });
});
