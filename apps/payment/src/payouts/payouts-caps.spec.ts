import Decimal from 'decimal.js';
import { PayoutsService } from './payouts.service';

function run(
  used: string,
  amount: string,
  perTransfer: string | null,
  daily: string | null,
) {
  const service = Object.create(PayoutsService.prototype) as {
    assertWithinCaps: (...a: unknown[]) => Promise<void>;
    outflowSince: jest.Mock;
    startOfLagosDay: () => Date;
  };
  service.outflowSince = jest.fn().mockResolvedValue(new Decimal(used));
  return service.assertWithinCaps({}, 'wallet', new Decimal(amount), {
    perTransfer,
    daily,
    tierPerTransfer: null,
    tierDaily: null,
  });
}

describe('customer transfer caps', () => {
  it('allows exactly the per-transfer cap, blocks above it', async () => {
    await expect(run('0', '50000', '50000', null)).resolves.toBeUndefined();
    await expect(run('0', '50000.01', '50000', null)).rejects.toMatchObject({
      status: 403,
      response: { code: 'TRANSFER_LIMIT' },
    });
  });

  it('daily cap is cumulative', async () => {
    await expect(
      run('85000', '15000', null, '100000'),
    ).resolves.toBeUndefined();
    await expect(
      run('85000', '15000.01', null, '100000'),
    ).rejects.toMatchObject({
      response: { remaining: '15000.00' },
    });
  });

  it('null caps mean unlimited', async () => {
    await expect(
      run('9999999', '9999999', null, null),
    ).resolves.toBeUndefined();
  });

  it('daily window starts at midnight Lagos (UTC+1)', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-31T23:30:00Z'));
    const s = Object.create(PayoutsService.prototype) as {
      startOfLagosDay: () => Date;
    };
    // 23:30Z is 00:30 on 1 Nov in Lagos → window opened 23:00Z on 31 Oct.
    expect(s.startOfLagosDay().toISOString()).toBe('2026-10-31T23:00:00.000Z');
    jest.useRealTimers();
  });
});

describe('checkCaps (shared with bill payments)', () => {
  const caps = {
    perTransfer: '1000',
    daily: null,
    tierPerTransfer: null,
    tierDaily: null,
  };
  const make = (enforce: boolean) => {
    const service = Object.create(PayoutsService.prototype) as {
      checkCaps: (...a: unknown[]) => Promise<void>;
      configService: unknown;
      outflowSince: jest.Mock;
    };
    service.configService = { get: () => ({ enforce }) };
    service.outflowSince = jest.fn();
    return service;
  };

  it('does nothing while enforcement is off', async () => {
    await expect(
      make(false).checkCaps({}, 'w', new Decimal('5000'), caps),
    ).resolves.toBeUndefined();
  });

  it('does nothing when auth sent no caps', async () => {
    await expect(
      make(true).checkCaps({}, 'w', new Decimal('5000'), null),
    ).resolves.toBeUndefined();
  });

  it('blocks over the cap once enforcement is on', async () => {
    await expect(
      make(true).checkCaps({}, 'w', new Decimal('1000.01'), caps),
    ).rejects.toMatchObject({ status: 403 });
  });
});
