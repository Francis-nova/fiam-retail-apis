/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await -- jest mock calls are untyped `any` by design */
import { HttpException } from '@nestjs/common';
import { PostingsService } from './postings.service';
import { PostingStatus, PostingType } from './entities/posting.entity';

const REQUESTER = {
  staffId: 'staff-req',
  email: 'finance@fiam.ng',
  role: 'FINANCE',
};
const APPROVER = {
  staffId: 'staff-app',
  email: 'compliance@fiam.ng',
  role: 'COMPLIANCE',
};
const ctx = (actor: typeof REQUESTER) => ({
  actor: actor as never,
  ip: '1.2.3.4',
});

function posting(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    customerId: 'c1',
    walletId: 'w1',
    currency: 'NGN',
    type: PostingType.CREDIT,
    amount: '5000.0000',
    reason: 'goodwill',
    narration: 'Account credit adjustment',
    status: PostingStatus.PENDING,
    requestedById: REQUESTER.staffId,
    requestedByEmail: REQUESTER.email,
    decidedById: null,
    ...over,
  };
}

function make(
  p: ReturnType<typeof posting>,
  opts: { claim?: boolean; payment?: () => Promise<unknown> } = {},
) {
  const repo = {
    findOneBy: jest.fn().mockImplementation(async () => ({ ...p })),
    update: jest.fn().mockResolvedValue({}),
    save: jest.fn().mockImplementation(async (x) => x),
    create: jest.fn().mockImplementation((x) => x),
    createQueryBuilder: jest.fn().mockReturnValue({
      update: () => ({
        set: () => ({
          where: () => ({
            execute: jest
              .fn()
              .mockResolvedValue({ affected: opts.claim === false ? 0 : 1 }),
          }),
        }),
      }),
    }),
  };
  const http = {
    call: jest.fn().mockImplementation(
      opts.payment ??
        (async () => ({
          transactionId: 't1',
          balanceAfter: '9000.00',
          replayed: false,
        })),
    ),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const customers = {
    contacts: jest.fn().mockResolvedValue(new Map()),
    snapshot: jest.fn().mockResolvedValue({ status: 'ACTIVE' }),
    walletFor: jest
      .fn()
      .mockResolvedValue({ id: 'w1', currency: 'NGN', balance: '1000.00' }),
  };
  const transactions = {
    depositForAssignment: jest.fn().mockResolvedValue({
      id: 'dep1',
      status: 'UNMATCHED',
      type: 'CREDIT',
      amount: '7500.0000',
      currency: 'NGN',
      wallet_id: null,
      reference: 'R1',
    }),
  };
  const svc = new PostingsService(
    repo as never,
    customers as never,
    transactions as never,
    http as never,
    audit as never,
  );
  return { svc, repo, http, audit, customers, transactions };
}

describe('PostingsService maker-checker', () => {
  describe('approve', () => {
    it('refuses to let the requester approve their own posting — and moves no money', async () => {
      const { svc, http } = make(posting());
      await expect(
        svc.approve('p1', undefined, ctx(REQUESTER)),
      ).rejects.toMatchObject({ status: 403 });
      expect(http.call).not.toHaveBeenCalled();
    });

    it('lets a different person approve: calls payment once with a stable idempotency reference', async () => {
      const { svc, http, audit } = make(posting());
      await svc.approve('p1', 'ok', ctx(APPROVER));
      expect(http.call).toHaveBeenCalledTimes(1);
      const [service, method, path, body] = http.call.mock.calls[0];
      expect([service, method, path]).toEqual(['payment', 'POST', '/postings']);
      expect(body).toMatchObject({
        reference: 'MAN-p1',
        walletId: 'w1',
        type: 'CREDIT',
        amount: '5000.0000',
      });
      expect(body.meta).toMatchObject({
        requestedBy: REQUESTER.email,
        approvedBy: APPROVER.email,
      });
      expect(audit.record.mock.calls.map((c) => c[0].action)).toContain(
        'posting.approved',
      );
    });

    it('does not post twice when someone else decided it first', async () => {
      const { svc, http } = make(posting(), { claim: false });
      await expect(
        svc.approve('p1', undefined, ctx(APPROVER)),
      ).rejects.toMatchObject({ status: 409 });
      expect(http.call).not.toHaveBeenCalled();
    });

    it.each([
      PostingStatus.POSTED,
      PostingStatus.REJECTED,
      PostingStatus.CANCELLED,
      PostingStatus.FAILED,
    ])('will not approve a posting that is already %s', async (status) => {
      const { svc, http } = make(posting({ status }));
      await expect(
        svc.approve('p1', undefined, ctx(APPROVER)),
      ).rejects.toMatchObject({ status: 409 });
      expect(http.call).not.toHaveBeenCalled();
    });

    it('only the same approver may retry a posting stuck PROCESSING', async () => {
      const stuck = posting({
        status: PostingStatus.PROCESSING,
        decidedById: APPROVER.staffId,
      });
      const other = {
        staffId: 'someone-else',
        email: 'x@fiam.ng',
        role: 'COMPLIANCE',
      };
      const a = make(stuck);
      await expect(
        a.svc.approve('p1', undefined, ctx(other)),
      ).rejects.toMatchObject({ status: 409 });
      expect(a.http.call).not.toHaveBeenCalled();
      const b = make(stuck);
      await b.svc.approve('p1', undefined, ctx(APPROVER));
      expect(b.http.call).toHaveBeenCalledTimes(1);
    });

    it('a definitive refusal (4xx) kills the posting', async () => {
      const { svc, repo, audit } = make(posting(), {
        payment: async () => {
          throw new HttpException('Insufficient balance', 400);
        },
      });
      await expect(
        svc.approve('p1', undefined, ctx(APPROVER)),
      ).rejects.toMatchObject({ status: 400 });
      expect(repo.update).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ status: PostingStatus.FAILED }),
      );
      expect(audit.record.mock.calls.map((c) => c[0].action)).toContain(
        'posting.failed',
      );
    });

    it('an unknown outcome (5xx/timeout) leaves it PROCESSING so a retry is safe', async () => {
      const { svc, repo } = make(posting(), {
        payment: async () => {
          throw new HttpException('upstream', 502);
        },
      });
      await expect(
        svc.approve('p1', undefined, ctx(APPROVER)),
      ).rejects.toMatchObject({ status: 503 });
      expect(repo.update).not.toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ status: PostingStatus.FAILED }),
      );
    });
  });

  describe('reject / cancel', () => {
    it("the requester can't reject their own posting", async () => {
      const { svc } = make(posting());
      await expect(
        svc.reject('p1', 'no', ctx(REQUESTER)),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('a different person can reject a pending posting', async () => {
      const { svc, audit } = make(posting());
      await svc.reject('p1', 'not justified', ctx(APPROVER));
      expect(audit.record.mock.calls.map((c) => c[0].action)).toContain(
        'posting.rejected',
      );
    });

    it('only the requester can cancel', async () => {
      const { svc } = make(posting());
      await expect(svc.cancel('p1', ctx(APPROVER))).rejects.toMatchObject({
        status: 403,
      });
      await expect(svc.cancel('p1', ctx(REQUESTER))).resolves.toBeDefined();
    });
  });

  describe('request', () => {
    const dto = {
      customerId: 'c1',
      type: PostingType.DEBIT,
      amount: '500',
      reason: 'chargeback',
    } as never;

    it('refuses a debit larger than the wallet balance', async () => {
      const { svc, repo } = make(posting());
      await expect(
        svc.request(
          { ...(dto as object), amount: '5000' } as never,
          ctx(REQUESTER),
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('refuses a closed account and a zero amount', async () => {
      const a = make(posting());
      a.customers.snapshot.mockResolvedValue({ status: 'CLOSED' });
      await expect(a.svc.request(dto, ctx(REQUESTER))).rejects.toMatchObject({
        status: 400,
      });
      const b = make(posting());
      await expect(
        b.svc.request(
          { ...(dto as object), amount: '0' } as never,
          ctx(REQUESTER),
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('records who asked, and audits the request', async () => {
      const { svc, repo, audit } = make(posting());
      await svc.request(dto, ctx(REQUESTER));
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          requestedById: REQUESTER.staffId,
          requestedByEmail: REQUESTER.email,
        }),
      );
      expect(audit.record.mock.calls.map((c) => c[0].action)).toContain(
        'posting.requested',
      );
    });
  });

  describe('assigning an unmatched deposit', () => {
    const dto = {
      customerId: 'c1',
      type: PostingType.DEBIT, // ignored: a deposit can only be credited
      amount: '1', // ignored: the deposit decides
      reason: 'identified by narration',
      sourceTransactionId: 'dep1',
    } as never;

    it('takes type and amount from the deposit, not the form', async () => {
      const { svc, repo } = make(posting());
      repo.findOne = jest.fn().mockResolvedValue(null);
      await svc.request(dto, ctx(REQUESTER));
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: PostingType.CREDIT,
          amount: '7500.0000',
          sourceTransactionId: 'dep1',
        }),
      );
    });

    it.each([
      ['a deposit that is no longer unmatched', { status: 'SUCCESSFUL' }],
      ['one already tied to a wallet', { wallet_id: 'w9' }],
      ['a payout, not a deposit', { type: 'DEBIT' }],
      ['one in another currency', { currency: 'USD' }],
    ])('refuses %s', async (_n, over) => {
      const { svc, repo, transactions } = make(posting());
      transactions.depositForAssignment.mockResolvedValue({
        id: 'dep1',
        status: 'UNMATCHED',
        type: 'CREDIT',
        amount: '7500.0000',
        currency: 'NGN',
        wallet_id: null,
        reference: 'R1',
        ...over,
      });
      await expect(svc.request(dto, ctx(REQUESTER))).rejects.toMatchObject({
        status: 400,
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('allows only one open request per deposit', async () => {
      const { svc, repo } = make(posting());
      repo.findOne = jest.fn().mockResolvedValue({ id: 'other-posting' });
      await expect(svc.request(dto, ctx(REQUESTER))).rejects.toMatchObject({
        status: 409,
      });
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('on approval credits THAT transaction via the assign endpoint (not a new posting)', async () => {
      const { svc, http } = make(posting({ sourceTransactionId: 'dep1' }));
      await svc.approve('p1', undefined, ctx(APPROVER));
      expect(http.call).toHaveBeenCalledTimes(1);
      const [service, method, path, body] = http.call.mock.calls[0];
      expect([service, method, path]).toEqual([
        'payment',
        'POST',
        '/unmatched/dep1/assign',
      ]);
      expect(body).toMatchObject({ walletId: 'w1', reference: 'MAN-p1' });
    });

    it('the requester still cannot approve their own assignment', async () => {
      const { svc, http } = make(posting({ sourceTransactionId: 'dep1' }));
      await expect(
        svc.approve('p1', undefined, ctx(REQUESTER)),
      ).rejects.toMatchObject({ status: 403 });
      expect(http.call).not.toHaveBeenCalled();
    });
  });
});
