import { randomBytes } from 'crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { CurrencyCode } from '@app/common';
import { PaymentConfig } from '../config/configuration';
import { WalletsService } from '../wallets/wallets.service';
import { AddressService } from '../wallets/address.service';
import { BeneficiariesService } from '../beneficiaries/beneficiaries.service';
import { BanksService } from '../banks/banks.service';
import { PAYMENT_PROVIDER_REGISTRY } from '../providers/payment-provider.registry';
import type { PaymentProviderRegistry } from '../providers/payment-provider.registry';
import type {
  ProviderTransferRecipient,
  ProviderTransferResult,
  ProviderTransferType,
} from '../providers/payment-provider.interface';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../transactions/entities/transaction.entity';
import {
  PAYOUT_STATUS_QUERY_QUEUE,
  PROCESS_PAYOUT_STATUS_QUERY_JOB,
  PayoutStatusQueryJobData,
} from './payout-status-query.queue';
import { ResolveRecipientDto } from './dto/resolve-recipient.dto';
import { InitiatePayoutDto } from './dto/initiate-payout.dto';
import { calculateTransferFeeMinor } from './fee.util';

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionsRepo: Repository<Transaction>,
    private readonly dataSource: DataSource,
    private readonly walletsService: WalletsService,
    private readonly addressService: AddressService,
    private readonly beneficiariesService: BeneficiariesService,
    private readonly banksService: BanksService,
    @Inject(PAYMENT_PROVIDER_REGISTRY)
    private readonly registry: PaymentProviderRegistry,
    @InjectQueue(PAYOUT_STATUS_QUERY_QUEUE)
    private readonly queue: Queue<PayoutStatusQueryJobData>,
    private readonly configService: ConfigService<PaymentConfig, true>,
  ) {}

  private transferType(bankCode: string): ProviderTransferType {
    const { bankCode: ownBankCode } = this.configService.get('vfd', {
      infer: true,
    });
    return bankCode === ownBankCode ? 'intra' : 'inter';
  }

  // Read-only name enquiry — lets the client confirm "paying <NAME>" before
  // the customer commits to an actual transfer.
  async resolveRecipient(dto: ResolveRecipientDto): Promise<{
    accountNumber: string;
    accountName: string | null;
    bankCode: string;
    bankName: string | null;
  }> {
    const provider = this.registry.getProviderForCurrency(CurrencyCode.NGN);
    const recipient = await provider.lookupTransferRecipient({
      accountNumber: dto.accountNumber,
      bankCode: dto.bankCode,
      transferType: this.transferType(dto.bankCode),
    });
    return {
      accountNumber: recipient.accountNumber,
      accountName: recipient.name,
      bankCode: dto.bankCode,
      bankName: recipient.bankName,
    };
  }

  calculateFee(amountMinorRaw: string): {
    amountMinor: string;
    feeMinor: string;
    totalMinor: string;
  } {
    let amountMinor: bigint;
    try {
      amountMinor = BigInt(amountMinorRaw);
    } catch {
      throw new BadRequestException('amountMinor must be a numeric string');
    }
    if (amountMinor <= 0n) {
      throw new BadRequestException('amountMinor must be greater than zero');
    }
    const feeMinor = calculateTransferFeeMinor(amountMinor);
    return {
      amountMinor: amountMinor.toString(),
      feeMinor: feeMinor.toString(),
      totalMinor: (amountMinor + feeMinor).toString(),
    };
  }

  async initiatePayout(
    userId: string,
    dto: InitiatePayoutDto,
  ): Promise<Transaction> {
    const provider = this.registry.getProviderForCurrency(CurrencyCode.NGN);
    const { walletName } = this.configService.get('vfd', { infer: true });

    let bankCode = dto.bankCode;
    let accountNumber = dto.accountNumber;
    if (dto.beneficiaryId) {
      const beneficiary = await this.beneficiariesService.findOwnedById(
        userId,
        dto.beneficiaryId,
      );
      bankCode = beneficiary.bankCode;
      accountNumber = beneficiary.accountNumber;
    }
    if (!bankCode || !accountNumber) {
      throw new BadRequestException(
        'beneficiaryId, or both bankCode and accountNumber, are required',
      );
    }

    const amountMinor = BigInt(dto.amountMinor);
    if (amountMinor <= 0n) {
      throw new BadRequestException('amountMinor must be greater than zero');
    }
    const feeMinor = calculateTransferFeeMinor(amountMinor);
    const debitMinor = amountMinor + feeMinor;

    const wallet = await this.walletsService.findByUserAndCurrency(
      userId,
      CurrencyCode.NGN,
    );
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    const address = await this.addressService.findActiveForWallet(wallet.id);
    if (!address) {
      throw new BadRequestException('No active payout account for this wallet');
    }

    const transferType = this.transferType(bankCode);

    // Both fresh per VFD's own documented golden path — the recipient's
    // clientId/accountId/session can be short-lived, so this is never read
    // from the saved Beneficiary row.
    const [fromDetails, recipient] = await Promise.all([
      provider.getAccountDetails(address.providerAccountNumber),
      provider.lookupTransferRecipient({
        accountNumber,
        bankCode,
        transferType,
      }),
    ]);

    const beneficiary = await this.saveBeneficiary(
      userId,
      provider.key,
      bankCode,
      recipient,
    );

    const reference = `${walletName}-${randomBytes(10).toString('hex')}`;

    const transaction = await this.dataSource.transaction(async (manager) => {
      // Debits amount + fee together — the fee is a platform charge on top
      // of what actually reaches the recipient (see initiateTransfer below,
      // which only ever sends `amountMinor` to VFD).
      const debited = await this.walletsService.debitForUpdate(
        manager,
        wallet.id,
        debitMinor,
      );
      return manager.save(
        Transaction,
        manager.create(Transaction, {
          walletId: wallet.id,
          currency: CurrencyCode.NGN,
          type: TransactionType.DEBIT,
          status: TransactionStatus.PROCESSING,
          provider: provider.key,
          accountNumber: address.providerAccountNumber,
          amountMinor: amountMinor.toString(),
          feeMinor: feeMinor.toString(),
          balanceAfterMinor: debited.balanceMinor,
          reference,
          beneficiaryId: beneficiary.id,
          narration: dto.narration ?? null,
        }),
      );
    });

    const result = await provider.initiateTransfer({
      from: fromDetails,
      to: recipient,
      bankCode,
      transferType,
      amountMinor,
      reference,
      narration: dto.narration ?? 'Payout',
    });

    return this.applyTransferResult(transaction, result);
  }

  private async saveBeneficiary(
    userId: string,
    provider: Transaction['provider'],
    bankCode: string,
    recipient: ProviderTransferRecipient,
  ) {
    const banks = await this.banksService.listBanks(CurrencyCode.NGN);
    const bankName =
      banks.find((bank) => bank.code === bankCode)?.name ??
      recipient.bankName ??
      null;

    // "Save all payout as a beneficiary" — every initiated payout upserts
    // one, regardless of whether the transfer itself ultimately succeeds
    // (the recipient details were already validated by the lookup above).
    return this.beneficiariesService.upsert({
      userId,
      currency: CurrencyCode.NGN,
      provider,
      bankCode,
      bankName,
      accountNumber: recipient.accountNumber,
      accountName: recipient.name,
    });
  }

  private async applyTransferResult(
    transaction: Transaction,
    result: ProviderTransferResult,
  ): Promise<Transaction> {
    await this.transactionsRepo.update(transaction.id, {
      externalId: result.externalId,
      providerStatusCode: result.providerStatusCode,
      // Cast: TypeORM's QueryDeepPartialEntity mapped type doesn't play
      // well with a nullable jsonb column typed as Record<string, unknown>
      // (same workaround as TransactionsService.recordPayin).
      rawPayload: result.rawPayload as never,
    });

    if (result.outcome === 'SUCCESSFUL') {
      await this.transactionsRepo.update(transaction.id, {
        status: TransactionStatus.SUCCESSFUL,
        verifiedAt: new Date(),
      });
    } else if (result.outcome === 'FAILED') {
      await this.reverseFailedPayout(transaction.id);
    } else {
      // REQUERY — VFD's response was ambiguous or unreachable; never guess,
      // poll TSQ until it resolves. ~10 attempts with exponential backoff
      // from 30s covers roughly the first several hours; if still
      // unresolved after that, onFailed() below logs for manual
      // reconciliation rather than assuming an outcome (see VFD's own
      // "Quick Guide" — pending beyond ~24h should be escalated to
      // support, not auto-resolved).
      await this.queue.add(
        PROCESS_PAYOUT_STATUS_QUERY_JOB,
        { transactionId: transaction.id },
        { attempts: 10, backoff: { type: 'exponential', delay: 30_000 } },
      );
    }
    return this.transactionsRepo.findOneByOrFail({ id: transaction.id });
  }

  // Public: also called by PayoutStatusQueryProcessor once TSQ confirms a
  // FAILED outcome. Idempotent against duplicate/racing calls — re-reads
  // the transaction inside the lock and no-ops if it's already terminal.
  async reverseFailedPayout(transactionId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const transaction = await manager.findOne(Transaction, {
        where: { id: transactionId },
      });
      if (
        !transaction ||
        transaction.status === TransactionStatus.SUCCESSFUL ||
        transaction.status === TransactionStatus.FAILED
      ) {
        return;
      }
      // Refund the full original debit — amount + fee, not amount alone
      // (older rows predating the fee column have feeMinor null, treated as
      // zero).
      const refundMinor =
        BigInt(transaction.amountMinor) + BigInt(transaction.feeMinor ?? '0');
      const wallet = await this.walletsService.creditForUpdate(
        manager,
        transaction.walletId as string,
        refundMinor,
      );
      await manager.update(Transaction, transaction.id, {
        status: TransactionStatus.FAILED,
        verifiedAt: new Date(),
      });
      // A separate ledger row for the reversal, rather than mutating the
      // original DEBIT's balanceAfterMinor — that field is an accurate
      // historical snapshot of the balance right after the debit was
      // applied; the reversal is its own distinct wallet-affecting event.
      await manager.save(
        Transaction,
        manager.create(Transaction, {
          walletId: transaction.walletId,
          currency: transaction.currency,
          type: TransactionType.CREDIT,
          status: TransactionStatus.SUCCESSFUL,
          provider: transaction.provider,
          accountNumber: transaction.accountNumber,
          amountMinor: refundMinor.toString(),
          balanceAfterMinor: wallet.balanceMinor,
          reference: `REV-${transaction.reference}`,
          beneficiaryId: transaction.beneficiaryId,
          narration: `Reversal for failed payout ${transaction.reference}`,
          verifiedAt: new Date(),
        }),
      );
      this.logger.warn(
        `Reversed failed payout ${transaction.reference} (transaction ${transaction.id})`,
      );
    });
  }
}
