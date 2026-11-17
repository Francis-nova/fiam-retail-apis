import Decimal from 'decimal.js';
import { CurrencyCode } from '@app/common';
import { CryptoService, normaliseAddress } from './crypto.service';
import { PaymentProviderKey } from '../wallets/entities/address.entity';

const compliance = {
  accountPurpose: 'PROTECT_WEALTH',
  sourceOfFunds: 'SALARY',
  employmentStatus: 'EMPLOYED',
  occupation: '151251',
  expectedMonthlyIncome: 1_000_000,
  acceptedRiskDisclosure: true,
} as const;

function setup(tier = 'TIER_3') {
  const config = {
    get: (key: string) =>
      key === 'auth'
        ? { internalUrl: 'http://auth', internalApiKey: 'k' }
        : key === 'stablestack.ngnMarkupPercent'
          ? '1'
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
  };
  const wallet = { id: 'w-1', balance: '0.00000000' };
  const walletsService = {
    getOrCreateWallet: jest.fn().mockResolvedValue(wallet),
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
  const dataSource = { createQueryRunner: () => runner };
  let customer: unknown = null;
  const customers = {
    findOneBy: jest.fn(() => Promise.resolve(customer)),
    create: (v: unknown) => v,
    save: jest.fn((v: unknown) => Promise.resolve((customer = v))),
  };
  const webhookEvents = { create: (v: unknown) => v, save: jest.fn() };

  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () =>
      Promise.resolve({
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Okafor',
        tier,
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
  );
  return { service, client, transactionsService, runner };
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
