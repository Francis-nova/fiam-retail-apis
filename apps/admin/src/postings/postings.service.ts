import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedStaff } from '../auth/current-staff.decorator';
import { InternalHttp } from '../common/internal-http.service';
import { CustomersService } from '../customers/customers.service';
import { TransactionsService } from '../transactions/transactions.service';
import { Posting, PostingStatus, PostingType } from './entities/posting.entity';
import { CreatePostingDto, ListPostingsQueryDto } from './dto/postings.dto';

interface Ctx {
  actor: AuthenticatedStaff;
  ip: string | null;
}

interface PaymentPostingResult {
  transactionId: string;
  balanceAfter: string;
  replayed: boolean;
}

const DEFAULT_NARRATION = {
  [PostingType.CREDIT]: 'Account credit adjustment',
  [PostingType.DEBIT]: 'Account debit adjustment',
};

// Manual wallet postings, maker-checker: one person requests, a *different*
// person approves, and only then does the payment service move the money.
@Injectable()
export class PostingsService {
  constructor(
    @InjectRepository(Posting) private readonly repo: Repository<Posting>,
    private readonly customers: CustomersService,
    private readonly transactions: TransactionsService,
    private readonly http: InternalHttp,
    private readonly audit: AuditService,
  ) {}

  private record(
    { actor, ip }: Ctx,
    action: string,
    p: Posting,
    extra: Record<string, unknown> = {},
  ) {
    return this.audit.record({
      staffId: actor.staffId,
      staffEmail: actor.email,
      action,
      resourceType: 'posting',
      resourceId: p.id,
      metadata: {
        customerId: p.customerId,
        type: p.type,
        amount: p.amount,
        currency: p.currency,
        ...extra,
      },
      ip,
    });
  }

  private async load(id: string) {
    const p = await this.repo.findOneBy({ id });
    if (!p) throw new NotFoundException('Posting not found');
    return p;
  }

  private async view(p: Posting) {
    const contact = (await this.customers.contacts([p.customerId])).get(
      p.customerId,
    );
    return this.shape(p, contact);
  }

  private shape(p: Posting, contact?: { name: string; email: string }) {
    return { ...p, customer: contact ?? null };
  }

  async request(dto: CreatePostingDto, ctx: Ctx) {
    const customer = await this.customers.snapshot(dto.customerId);
    if (customer.status === 'CLOSED') {
      throw new BadRequestException('This account is closed');
    }
    const wallet = await this.customers.walletFor(dto.customerId, 'NGN');
    if (!wallet) throw new BadRequestException('This customer has no wallet');

    let type = dto.type;
    let amount = dto.amount;
    if (dto.sourceTransactionId) {
      // Assigning an unmatched deposit: what it is worth, and that it really
      // is still unassigned, comes from the deposit itself — never the form.
      const dep = await this.transactions.depositForAssignment(
        dto.sourceTransactionId,
      );
      if (
        dep.type !== 'CREDIT' ||
        dep.status !== 'UNMATCHED' ||
        dep.wallet_id !== null
      ) {
        throw new BadRequestException(
          'That deposit is not awaiting assignment',
        );
      }
      if (dep.currency !== wallet.currency) {
        throw new BadRequestException(
          `The deposit is in ${dep.currency}; this customer's wallet is ${wallet.currency}`,
        );
      }
      type = PostingType.CREDIT;
      amount = dep.amount;
      const open = await this.repo.findOne({
        where: [
          {
            sourceTransactionId: dto.sourceTransactionId,
            status: PostingStatus.PENDING,
          },
          {
            sourceTransactionId: dto.sourceTransactionId,
            status: PostingStatus.PROCESSING,
          },
        ],
      });
      if (open) {
        throw new ConflictException(
          'There is already a pending request for this deposit',
        );
      }
    }
    if (Number(amount) <= 0) {
      throw new BadRequestException('Amount must be greater than zero');
    }
    // Early feedback only — the payment service re-checks under a row lock
    // when the posting is actually applied.
    if (type === PostingType.DEBIT && Number(wallet.balance) < Number(amount)) {
      throw new BadRequestException(
        `Insufficient balance (wallet holds ${wallet.balance})`,
      );
    }
    const posting = await this.repo.save(
      this.repo.create({
        customerId: dto.customerId,
        walletId: wallet.id,
        currency: wallet.currency,
        type,
        amount,
        sourceTransactionId: dto.sourceTransactionId ?? null,
        reason: dto.reason.trim(),
        narration: dto.narration?.trim() || DEFAULT_NARRATION[type],
        requestedById: ctx.actor.staffId,
        requestedByEmail: ctx.actor.email,
      }),
    );
    await this.record(ctx, 'posting.requested', posting, {
      reason: posting.reason,
      narration: posting.narration,
    });
    return this.view(posting);
  }

  async list(q: ListPostingsQueryDto) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const qb = this.repo.createQueryBuilder('p').orderBy('p.createdAt', 'DESC');
    if (q.status?.length) qb.andWhere('p.status IN (:...s)', { s: q.status });
    if (q.customerId) qb.andWhere('p.customerId = :c', { c: q.customerId });
    const [items, total] = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    const contacts = await this.customers.contacts(
      items.map((i) => i.customerId),
    );
    return {
      items: items.map((p) => this.shape(p, contacts.get(p.customerId))),
      total,
      page,
      pageSize,
    };
  }

  async get(id: string) {
    return this.view(await this.load(id));
  }

  // Atomically moves PENDING -> `to`; false if someone else got there first.
  private async claim(id: string, to: PostingStatus, ctx: Ctx, note?: string) {
    const res = await this.repo
      .createQueryBuilder()
      .update(Posting)
      .set({
        status: to,
        decidedById: ctx.actor.staffId,
        decidedByEmail: ctx.actor.email,
        decidedAt: new Date(),
        decisionNote: note ?? null,
      })
      .where('id = :id AND status = :pending', {
        id,
        pending: PostingStatus.PENDING,
      })
      .execute();
    return (res.affected ?? 0) === 1;
  }

  async approve(id: string, note: string | undefined, ctx: Ctx) {
    const p = await this.load(id);
    if (p.requestedById === ctx.actor.staffId) {
      throw new ForbiddenException("You can't approve your own request");
    }
    if (p.status === PostingStatus.PENDING) {
      if (!(await this.claim(id, PostingStatus.PROCESSING, ctx, note))) {
        throw new ConflictException(
          'This posting was just decided by someone else',
        );
      }
    } else if (
      // A previous attempt didn't get an answer from the payment service.
      // Only the same approver may retry; the call is idempotent.
      !(
        p.status === PostingStatus.PROCESSING &&
        p.decidedById === ctx.actor.staffId
      )
    ) {
      throw new ConflictException(
        `This posting is already ${p.status.toLowerCase()}`,
      );
    }

    try {
      const meta = {
        postingId: p.id,
        reason: p.reason,
        requestedBy: p.requestedByEmail,
        approvedBy: ctx.actor.email,
      };
      // Resolving an unmatched deposit turns that very transaction into the
      // customer's credit (no second row); everything else is a new posting.
      const result = p.sourceTransactionId
        ? await this.http.call<PaymentPostingResult>(
            'payment',
            'POST',
            `/unmatched/${p.sourceTransactionId}/assign`,
            { walletId: p.walletId, reference: `MAN-${p.id}`, meta },
          )
        : await this.http.call<PaymentPostingResult>(
            'payment',
            'POST',
            '/postings',
            {
              walletId: p.walletId,
              type: p.type,
              amount: p.amount,
              reference: `MAN-${p.id}`,
              narration: p.narration,
              meta,
            },
          );
      await this.repo.update(id, {
        status: PostingStatus.POSTED,
        transactionId: result.transactionId,
        balanceAfter: result.balanceAfter,
        failureReason: null,
      });
      const done = await this.load(id);
      await this.record(ctx, 'posting.approved', done, {
        transactionId: result.transactionId,
        balanceAfter: result.balanceAfter,
        note,
      });
      return this.view(done);
    } catch (err) {
      // 4xx = the payment service definitively refused (e.g. insufficient
      // balance): the posting is dead and must be re-requested. Anything else
      // (unreachable, timeout, 5xx) is unknown — leave it PROCESSING.
      if (err instanceof HttpException && err.getStatus() < 500) {
        const message = err.message;
        await this.repo.update(id, {
          status: PostingStatus.FAILED,
          failureReason: message,
        });
        await this.record(ctx, 'posting.failed', p, { failureReason: message });
        throw new BadRequestException(`Could not post: ${message}`);
      }
      throw new HttpException(
        'The payment service did not confirm the posting. It may or may not have been applied — approve again to retry safely.',
        503,
      );
    }
  }

  async reject(id: string, note: string, ctx: Ctx) {
    const p = await this.load(id);
    if (p.requestedById === ctx.actor.staffId) {
      throw new ForbiddenException(
        "You can't decide your own request — cancel it instead",
      );
    }
    if (!(await this.claim(id, PostingStatus.REJECTED, ctx, note))) {
      throw new ConflictException(
        `This posting is already ${p.status.toLowerCase()}`,
      );
    }
    await this.record(ctx, 'posting.rejected', p, { note });
    return this.get(id);
  }

  async cancel(id: string, ctx: Ctx) {
    const p = await this.load(id);
    if (p.requestedById !== ctx.actor.staffId) {
      throw new ForbiddenException(
        'Only the person who requested it can cancel',
      );
    }
    if (!(await this.claim(id, PostingStatus.CANCELLED, ctx))) {
      throw new ConflictException(
        `This posting is already ${p.status.toLowerCase()}`,
      );
    }
    await this.record(ctx, 'posting.cancelled', p);
    return this.get(id);
  }
}
