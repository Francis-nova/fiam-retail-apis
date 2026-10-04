import Decimal from 'decimal.js';
import { PayoutsService } from './payouts.service';

// The CBN new-device cap: N20,000 cumulative outflow in the 24h window.
function run(used: string, amount: string, limit: object | null) {
  const service = Object.create(PayoutsService.prototype) as {
    assertWithinTransferLimit: (...a: unknown[]) => Promise<void>;
    outflowSince: jest.Mock;
  };
  service.outflowSince = jest.fn().mockResolvedValue(new Decimal(used));
  return service.assertWithinTransferLimit(
    {},
    'wallet',
    new Decimal(amount),
    limit,
  );
}

const LIMIT = {
  amount: '20000.00',
  since: '2026-10-04T10:00:00.000Z',
  until: '2026-10-05T10:00:00.000Z',
};

describe('new-device transfer limit', () => {
  it('does nothing when no limit applies', async () => {
    await expect(run('999999', '500000', null)).resolves.toBeUndefined();
  });

  it('allows up to exactly the cap in total', async () => {
    await expect(run('0', '20000', LIMIT)).resolves.toBeUndefined();
    await expect(run('15000', '5000', LIMIT)).resolves.toBeUndefined();
  });

  it('blocks a single transfer over the cap', async () => {
    await expect(run('0', '20000.01', LIMIT)).rejects.toMatchObject({
      status: 403,
      response: { code: 'NEW_DEVICE_LIMIT', remaining: '20000.00' },
    });
  });

  it('is cumulative: earlier transfers in the window use up the cap', async () => {
    await expect(run('15000', '5000.01', LIMIT)).rejects.toMatchObject({
      status: 403,
      response: { remaining: '5000.00' },
    });
    await expect(run('20000', '1', LIMIT)).rejects.toMatchObject({
      response: { remaining: '0.00' },
    });
  });
});
