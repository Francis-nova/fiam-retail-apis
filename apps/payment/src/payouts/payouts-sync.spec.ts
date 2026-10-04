/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest mocks are untyped by design */
import { PayoutsService } from './payouts.service';

type Outcome = 'SUCCESSFUL' | 'FAILED' | 'HOLD' | 'REQUERY';

function make(status: string | null, outcome: Outcome = 'SUCCESSFUL') {
  const repo = {
    findOneBy: jest.fn().mockResolvedValue(
      status
        ? {
            id: 't1',
            status,
            provider: 'VFD',
            reference: 'ADL1',
            externalId: null,
            rawPayload: null,
          }
        : null,
    ),
    update: jest.fn().mockResolvedValue({}),
  };
  const provider = {
    queryTransferStatus: jest.fn().mockResolvedValue({
      outcome,
      providerStatusCode: '00',
      externalId: 'x',
      rawPayload: {},
    }),
  };
  const svc = Object.create(PayoutsService.prototype) as Record<
    string,
    unknown
  >;
  Object.assign(svc, {
    transactionsRepo: repo,
    registry: { getProviderByKey: () => provider },
    notifications: { notifyTransaction: jest.fn() },
    reverseFailedPayout: jest.fn().mockResolvedValue(undefined),
    holdForReview: jest.fn(),
  });
  return {
    svc: svc as unknown as PayoutsService,
    repo,
    provider,
    internals: svc as Record<string, jest.Mock | Record<string, jest.Mock>>,
  };
}

describe('PayoutsService.syncPayoutStatus', () => {
  it('NOT_FOUND for an unknown transaction, and never asks the provider', async () => {
    const { svc, provider } = make(null);
    expect(await svc.syncPayoutStatus('t1')).toBe('NOT_FOUND');
    expect(provider.queryTransferStatus).not.toHaveBeenCalled();
  });

  it.each(['SUCCESSFUL', 'FAILED'])(
    'leaves an already %s payout alone',
    async (status) => {
      const { svc, provider, repo } = make(status);
      expect(await svc.syncPayoutStatus('t1')).toBe('ALREADY_FINAL');
      expect(provider.queryTransferStatus).not.toHaveBeenCalled();
      expect(repo.update).not.toHaveBeenCalled();
    },
  );

  it('marks SUCCESSFUL when the provider says so', async () => {
    const { svc, repo } = make('PROCESSING', 'SUCCESSFUL');
    expect(await svc.syncPayoutStatus('t1')).toBe('SUCCESSFUL');
    expect(repo.update).toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ status: 'SUCCESSFUL' }),
    );
  });

  it('reverses (refunds) only on a definitive FAILED', async () => {
    const { svc, internals } = make('PROCESSING', 'FAILED');
    expect(await svc.syncPayoutStatus('t1')).toBe('FAILED');
    expect(internals.reverseFailedPayout).toHaveBeenCalledWith('t1');
  });

  it('holds for review without reversing', async () => {
    const { svc, internals } = make('PROCESSING', 'HOLD');
    expect(await svc.syncPayoutStatus('t1')).toBe('HOLD');
    expect(internals.holdForReview).toHaveBeenCalled();
    expect(internals.reverseFailedPayout).not.toHaveBeenCalled();
  });

  it('never guesses: an unresolved answer changes no status and refunds nothing', async () => {
    const { svc, repo, internals } = make('PROCESSING', 'REQUERY');
    expect(await svc.syncPayoutStatus('t1')).toBe('UNRESOLVED');
    expect(repo.update).not.toHaveBeenCalledWith(
      't1',
      expect.objectContaining({ status: expect.anything() }),
    );
    expect(internals.reverseFailedPayout).not.toHaveBeenCalled();
  });
});
