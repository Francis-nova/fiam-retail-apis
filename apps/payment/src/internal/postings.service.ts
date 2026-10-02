import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource, Repository } from 'typeorm';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../transactions/entities/transaction.entity';
import { PaymentProviderKey } from '../wallets/entities/address.entity';
import { Wallet } from '../wallets/entities/wallet.entity';
import { WalletsService } from '../wallets/wallets.service';
import { NotificationsService } from '../notifications/notifications.service';
import { CreatePostingDto } from './postings.dto';

const UNIQUE_VIOLATION = '23505';

// Applies a staff-approved manual credit/debit. The approval workflow lives in
// the admin service; this only guarantees the money movement is atomic and
// idempotent — the balance change and its transaction row commit together, and
// replaying a reference returns the original instead of posting twice.
@Injectable()
export class PostingsService {
  private readonly logger = new Logger(PostingsService.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly wallets: WalletsService,
    private readonly notifications: NotificationsService,
  ) {}

  private view(t: Transaction) {
    return {
      transactionId: t.id,
      status: t.status,
      type: t.type,
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      reference: t.reference,
    };
  }

  private findExisting(reference: string) {
    return this.transactions.findOneBy({
      provider: PaymentProviderKey.MANUAL,
      reference,
    });
  }

  async post(dto: CreatePostingDto) {
    const amount = new Decimal(dto.amount);
    if (!amount.greaterThan(0)) {
      throw new BadRequestException('Amount must be greater than zero');
    }

    const replay = await this.findExisting(dto.reference);
    if (replay) return { ...this.view(replay), replayed: true };

    let created: Transaction;
    try {
      created = await this.dataSource.transaction(async (manager) => {
        const wallet =
          dto.type === TransactionType.CREDIT
            ? await this.wallets.creditForUpdate(manager, dto.walletId, amount)
            : await this.wallets.debitForUpdate(manager, dto.walletId, amount);
        const account = await manager.query<{ n: string }[]>(
          `SELECT provider_account_number AS n FROM addresses
            WHERE wallet_id = $1 AND status = 'ACTIVE' LIMIT 1`,
          [dto.walletId],
        );
        return manager.save(
          manager.create(Transaction, {
            walletId: dto.walletId,
            currency: (wallet as Wallet).currency,
            type: dto.type,
            status: TransactionStatus.SUCCESSFUL,
            provider: PaymentProviderKey.MANUAL,
            accountNumber: account[0]?.n ?? 'MANUAL',
            amount: amount.toFixed(4),
            balanceAfter: wallet.balance,
            reference: dto.reference,
            narration: dto.narration,
            occurredAt: new Date(),
            verifiedAt: new Date(),
            rawPayload: { manual: true, ...dto.meta },
          }),
        );
      });
    } catch (err) {
      // Two concurrent calls with one reference: the loser's whole DB
      // transaction (balance change included) rolled back on the unique index.
      if ((err as { code?: string }).code === UNIQUE_VIOLATION) {
        const winner = await this.findExisting(dto.reference);
        if (winner) return { ...this.view(winner), replayed: true };
      }
      throw err;
    }

    this.logger.log(
      `Manual ${dto.type} of ${created.amount} posted to wallet ${dto.walletId} (${dto.reference})`,
    );
    // Best-effort, never blocks or rolls back the posting. Both directions
    // tell the customer — a silent debit would be worse than none.
    void this.notifications.notifyTransaction(
      created,
      dto.type === TransactionType.CREDIT
        ? 'ACCOUNT_CREDITED'
        : 'ACCOUNT_DEBITED',
    );
    return { ...this.view(created), replayed: false };
  }
}
