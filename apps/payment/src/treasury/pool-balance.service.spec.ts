import Decimal from 'decimal.js';
import { PoolBalanceService } from './pool-balance.service';

function setup(
  poolBalance: string | null | undefined,
  walletRow: { total: string; count: string } | undefined,
) {
  const query = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue(walletRow),
  };
  const wallets = { createQueryBuilder: jest.fn().mockReturnValue(query) };
  const provider = {
    getAccountDetails: jest.fn().mockResolvedValue({ balance: poolBalance }),
  };
  const registry = {
    getProviderForCurrency: jest.fn().mockReturnValue(provider),
  };
  const slack = { poolBalance: jest.fn() };
  const service = new PoolBalanceService(
    wallets as never,
    registry as never,
    slack as never,
  );
  return { service, provider, slack };
}

describe('PoolBalanceService', () => {
  it('reads the pool account (no account number) and sums NGN customer wallets', async () => {
    const { service, provider, slack } = setup('1,500,000.25', {
      total: '1200000.5000',
      count: '12',
    });
    const out = await service.report();
    expect(provider.getAccountDetails).toHaveBeenCalledWith();
    expect(out.pool.equals(new Decimal('1500000.25'))).toBe(true);
    expect(out.customers.equals(new Decimal('1200000.5'))).toBe(true);
    expect(out.count).toBe(12);
    expect(slack.poolBalance).toHaveBeenCalledWith({
      pool: out.pool,
      customers: out.customers,
      customerCount: 12,
    });
  });

  it('treats no customer wallets as zero', async () => {
    const { service } = setup('500', { total: '0', count: '0' });
    expect((await service.report()).customers.isZero()).toBe(true);
  });

  it('throws, and posts nothing, when the provider returns no balance', async () => {
    const { service, slack } = setup(null, { total: '1', count: '1' });
    await expect(service.report()).rejects.toThrow('pool account balance');
    expect(slack.poolBalance).not.toHaveBeenCalled();
  });
});
