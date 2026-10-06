import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource } from 'typeorm';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../transactions/entities/transaction.entity';
import { WalletsService } from '../wallets/wallets.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AssignUnmatchedDto } from './unmatched.dto';

// A deposit that reached the provider for an account we can't match to a
// wallet is recorded as UNMATCHED and parked. This is the controlled way out:
// once staff (maker-checker, in the admin service) decide whose money it is,
// the same row becomes that wallet's credit — no second transaction row, so
// the ledger can't count the money twice.
@Injectable()
export class UnmatchedService {
  private readonly logger = new Logger(UnmatchedService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly wallets: WalletsService,
    private readonly notifications: NotificationsService,
  ) {}

  async assign(transactionId: string, dto: AssignUnmatchedDto) {
    const result = await this.dataSource.transaction(async (manager) => {
      const txn = await manager
        .createQueryBuilder(Transaction, 't')
        .setLock('pessimistic_write')
        .where('t.id = :id', { id: transactionId })
        .getOne();
      if (!txn) throw new NotFoundException('Transaction not found');

      // Idempotent: the same approval retried after a lost response.
      if (
        txn.status === TransactionStatus.SUCCESSFUL &&
        txn.walletId === dto.walletId
      ) {
        return { txn, replayed: true };
      }
      if (
        txn.type !== TransactionType.CREDIT ||
        txn.status !== TransactionStatus.UNMATCHED ||
        txn.walletId !== null
      ) {
        throw new ConflictException('This deposit is not awaiting assignment');
      }

      const wallet = await this.wallets.creditForUpdate(
        manager,
        dto.walletId,
        new Decimal(txn.amount),
      );
      if (wallet.currency !== txn.currency) {
        // Throwing rolls the whole DB transaction back, credit included.
        throw new BadRequestException(
          `Currency mismatch: deposit is ${String(txn.currency)}, wallet is ${String(wallet.currency)}`,
        );
      }

      await manager.update(Transaction, txn.id, {
        walletId: wallet.id,
        status: TransactionStatus.SUCCESSFUL,
        balanceAfter: wallet.balance,
        verifiedAt: new Date(),
        // Keep the provider's payload and add who resolved it and why.
        rawPayload: {
          ...(txn.rawPayload ?? {}),
          resolution: {
            reference: dto.reference,
            at: new Date().toISOString(),
            ...dto.meta,
          },
        },
      });
      const done = await manager.findOneByOrFail(Transaction, { id: txn.id });
      return { txn: done, replayed: false };
    });

    if (!result.replayed) {
      this.logger.log(
        `Unmatched deposit ${transactionId} assigned to wallet ${dto.walletId} (${dto.reference})`,
      );
      // Best-effort, like every other credit: the customer hears about it.
      void this.notifications.notifyTransaction(result.txn, 'CREDIT_RECEIVED');
    }
    return {
      transactionId: result.txn.id,
      status: result.txn.status,
      amount: result.txn.amount,
      balanceAfter: result.txn.balanceAfter,
      replayed: result.replayed,
    };
  }
}
