import { randomInt } from 'crypto';
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
import Decimal from 'decimal.js';
import type Redis from 'ioredis';
import { CurrencyCode, withJobRequestId } from '@app/common';
import { PaymentConfig } from '../config/configuration';
import { REDIS_CLIENT } from '../redis/redis.module';
import { WalletsService } from '../wallets/wallets.service';
import { AddressService } from '../wallets/address.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PinVerifierService } from '../payouts/pin-verifier.service';
import { PAYMENT_PROVIDER_REGISTRY } from '../providers/payment-provider.registry';
import type { PaymentProviderRegistry } from '../providers/payment-provider.registry';
import type {
  ProviderBillItem,
  ProviderBillResult,
  ProviderBiller,
} from '../providers/bills-provider.interface';
import {
  Transaction,
  TransactionKind,
  TransactionStatus,
  TransactionType,
  billTypeFromCategory,
} from '../transactions/entities/transaction.entity';
import {
  BILL_STATUS_QUERY_QUEUE,
  BillStatusQueryJobData,
  PROCESS_BILL_STATUS_QUERY_JOB,
} from './bill-status-query.queue';
import { calculateBillFees } from './bill-fee';
import { assertBillerRules } from './biller-rules';
import { CustomerPhoneService } from './customer-phone';
import { BillBeneficiariesService } from './bill-beneficiaries.service';
import { BillerRefDto, PayBillDto, ValidateCustomerDto } from './dto/bills.dto';

const CATEGORIES_TTL_SECONDS = 24 * 60 * 60;
// Prod returns a comprehensive biller list that changes occasionally.
const BILLERS_TTL_SECONDS = 60 * 60;

// VFD requires customer validation for these; optional for airtime/data.
const VALIDATION_REQUIRED_CATEGORIES = new Set([
  'utility',
  'cable tv',
  'betting',
  'gaming',
]);

type BillerKey = Pick<ProviderBiller, 'id' | 'division' | 'product'>;

@Injectable()
export class BillsService {
  private readonly logger = new Logger(BillsService.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionsRepo: Repository<Transaction>,
    private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly walletsService: WalletsService,
    private readonly addressService: AddressService,
    private readonly notifications: NotificationsService,
    private readonly pinVerifier: PinVerifierService,
    @Inject(PAYMENT_PROVIDER_REGISTRY)
    private readonly registry: PaymentProviderRegistry,
    @InjectQueue(BILL_STATUS_QUERY_QUEUE)
    private readonly queue: Queue<BillStatusQueryJobData>,
    private readonly configService: ConfigService<PaymentConfig, true>,
    private readonly customerPhone: CustomerPhoneService,
    private readonly billBeneficiaries: BillBeneficiariesService,
  ) {}

  // ---- Catalogue (read-only) ----------------------------------------------

  private async cached<T>(
    key: string,
    ttlSeconds: number,
    load: () => Promise<T[]>,
  ): Promise<T[]> {
    const hit = await this.redis.get(key);
    if (hit) {
      try {
        const parsed = JSON.parse(hit) as T[];
        if (parsed.length > 0) return parsed;
      } catch {
        this.logger.warn(`Corrupt cache entry at ${key} — refetching`);
      }
    }
    const fresh = await load();
    if (fresh.length > 0) {
      await this.redis.set(key, JSON.stringify(fresh), 'EX', ttlSeconds);
    }
    return fresh;
  }

  listCategories(): Promise<string[]> {
    const provider = this.registry.getBillsProvider();
    return this.cached(
      'payment:bills:categories:VFD',
      CATEGORIES_TTL_SECONDS,
      () => provider.listBillCategories(),
    );
  }

  listBillers(category?: string): Promise<ProviderBiller[]> {
    const provider = this.registry.getBillsProvider();
    const scope = category?.trim().toLowerCase() || 'all';
    return this.cached(
      `payment:bills:billers:VFD:${scope}`,
      BILLERS_TTL_SECONDS,
      () => provider.listBillers(category?.trim() || undefined),
    );
  }

  private feeFor(biller: Pick<ProviderBiller, 'category' | 'convenienceFee'>) {
    const { serviceFee } = this.configService.get('bills', { infer: true });
    return calculateBillFees(biller, serviceFee);
  }

  // The catalogue as the app sees it: each biller carries `fee`, the total the
  // customer will be charged on top of the bill, so the screen never has to
  // work it out. Applied here rather than in the cached copy so a config change
  // takes effect immediately. Pay recomputes it independently.
  async listBillersWithFees(
    category?: string,
  ): Promise<(ProviderBiller & { fee: string })[]> {
    const billers = await this.listBillers(category);
    return billers.map((b) => ({ ...b, fee: this.feeFor(b).total.toFixed(2) }));
  }

  // Never cached: VFD says items are dynamic (prices, bundles).
  listItems(ref: BillerRefDto): Promise<ProviderBillItem[]> {
    return this.registry.getBillsProvider().listBillItems({
      id: ref.billerId,
      division: ref.divisionId,
      product: ref.productId,
    });
  }

  // Resolves the client-supplied ids against the provider's own catalogue, so
  // category and convenience fee are never taken from the request body.
  private async resolveBiller(ref: BillerRefDto): Promise<ProviderBiller> {
    const billers = await this.listBillers();
    const biller = billers.find(
      (b) =>
        b.id === ref.billerId &&
        b.division === ref.divisionId &&
        b.product === ref.productId,
    );
    if (!biller) throw new BadRequestException('Unknown biller');
    return biller;
  }

  private toKey(dto: BillerRefDto): BillerKey {
    return {
      id: dto.billerId,
      division: dto.divisionId,
      product: dto.productId,
    };
  }

  async validateCustomer(
    dto: ValidateCustomerDto,
  ): Promise<{ valid: true; customerId: string }> {
    const biller = await this.resolveBiller(dto);
    const ok = await this.registry.getBillsProvider().validateBillCustomer({
      customerId: dto.customerId,
      biller: this.toKey(dto),
      paymentItem: dto.paymentItem,
    });
    if (!ok) {
      throw new BadRequestException(
        `We couldn't verify that ${biller.name} number. Please check it and try again.`,
      );
    }
    return { valid: true, customerId: dto.customerId };
  }

  // ---- Pay ----------------------------------------------------------------

  async payBill(userId: string, dto: PayBillDto): Promise<Transaction> {
    // First, before anything is looked up or reserved.
    await this.pinVerifier.assertValid(userId, dto.pin);

    const provider = this.registry.getBillsProvider();
    const { walletName } = this.configService.get('vfd', { infer: true });

    const biller = await this.resolveBiller(dto);

    // The item list is the source of truth for what may be bought and, for
    // fixed-price items, at what price.
    const items = await provider.listBillItems(this.toKey(dto));
    const item = items.find((i) => i.paymentCode === dto.paymentItem);
    if (!item) throw new BadRequestException('Unknown payment item');

    // The provider's item list decides who owns the amount: a fixed-price item
    // is priced by the backend (the client's figure, if any, must agree);
    // anything else is the customer's to choose.
    let amount: Decimal;
    if (item.isAmountFixed && item.amount !== null && Number(item.amount) > 0) {
      amount = new Decimal(item.amount);
      if (dto.amount !== undefined && !new Decimal(dto.amount).equals(amount)) {
        throw new BadRequestException(
          `${item.name} costs ₦${amount.toFixed(2)}`,
        );
      }
    } else {
      if (dto.amount === undefined) {
        throw new BadRequestException('amount is required');
      }
      amount = new Decimal(dto.amount);
      if (amount.lessThanOrEqualTo(0)) {
        throw new BadRequestException('amount must be greater than zero');
      }
    }
    // VFD wants a phone number on some billers (mandatory for IKEDC) and it is
    // harmless on the rest, so when the customer didn't give one, use their own.
    const phoneNumber =
      dto.phoneNumber?.trim() || (await this.customerPhone.lookup(userId));
    assertBillerRules({ biller, item, amount, phoneNumber });

    if (VALIDATION_REQUIRED_CATEGORIES.has(biller.category.toLowerCase())) {
      const ok = await provider.validateBillCustomer({
        customerId: dto.customerId,
        biller: this.toKey(dto),
        paymentItem: dto.paymentItem,
      });
      if (!ok) {
        throw new BadRequestException(
          `We couldn't verify that ${biller.name} number. Please check it and try again.`,
        );
      }
    }

    // Charged to the customer on top of the bill; only `amount` goes to VFD.
    const fee = this.feeFor(biller).total;
    const debit = amount.plus(fee);

    const wallet = await this.walletsService.findByUserAndCurrency(
      userId,
      CurrencyCode.NGN,
    );
    if (!wallet) throw new NotFoundException('Wallet not found');
    const address = await this.addressService.findActiveForWallet(wallet.id);
    if (!address) {
      throw new BadRequestException('No active account for this wallet');
    }

    const reference = await this.generateReference(walletName);
    const transaction = await this.dataSource.transaction(async (manager) => {
      const debited = await this.walletsService.debitForUpdate(
        manager,
        wallet.id,
        debit,
      );
      return manager.save(
        Transaction,
        manager.create(Transaction, {
          walletId: wallet.id,
          currency: CurrencyCode.NGN,
          type: TransactionType.DEBIT,
          kind: TransactionKind.BILL_PAYMENT,
          billType: billTypeFromCategory(biller.category),
          status: TransactionStatus.PROCESSING,
          provider: this.registry.getProviderForCurrency(CurrencyCode.NGN).key,
          accountNumber: address.providerAccountNumber,
          amount: amount.toFixed(4),
          fee: fee.toFixed(4),
          balanceAfter: debited.balance,
          reference,
          narration: `${biller.name} — ${item.name}`.slice(0, 255),
          bill: {
            category: biller.category,
            billerId: biller.id,
            billerName: biller.name,
            division: biller.division,
            productId: biller.product,
            paymentItem: item.paymentCode,
            paymentItemName: item.name,
            customerId: dto.customerId,
            token: null,
          },
        }),
      );
    });

    const result = await provider.payBill({
      customerId: dto.customerId,
      amount,
      biller,
      paymentItem: item.paymentCode,
      reference,
      phoneNumber,
    });
    return this.applyResult(transaction, result);
  }

  // ---- Result handling ----------------------------------------------------

  private async applyResult(
    transaction: Transaction,
    initial: ProviderBillResult,
  ): Promise<Transaction> {
    let result = initial;

    await this.transactionsRepo.update(transaction.id, {
      providerStatusCode: result.providerStatusCode,
      rawPayload: result.rawPayload as never,
    });

    if (result.outcome === 'SUCCESSFUL') {
      // The pay response doesn't carry the utility token; the status call
      // does. Best effort — the poller-less path just leaves it null.
      if (!result.token && this.isTokenCategory(transaction)) {
        result = await this.registry
          .getBillsProvider()
          .queryBillStatus(transaction.reference)
          .then((r) => (r.outcome === 'SUCCESSFUL' ? r : initial))
          .catch(() => initial);
      }
      await this.markSuccessful(transaction, result.token);
    } else if (result.outcome === 'FAILED') {
      await this.reverseFailedBill(transaction.id);
    } else {
      // Unknown or pending — never guess. First look after 30s so a request
      // VFD is still processing isn't mistaken for "No Transaction!".
      await this.queue.add(
        PROCESS_BILL_STATUS_QUERY_JOB,
        withJobRequestId({ transactionId: transaction.id }),
        {
          attempts: 10,
          delay: 30_000,
          backoff: { type: 'exponential', delay: 30_000 },
        },
      );
    }
    return this.transactionsRepo.findOneByOrFail({ id: transaction.id });
  }

  private isTokenCategory(transaction: Transaction): boolean {
    const category = transaction.bill?.category.toLowerCase();
    return category === 'utility' || category === 'cable tv';
  }

  private async markSuccessful(
    transaction: Transaction,
    token: string | null,
  ): Promise<void> {
    await this.transactionsRepo.update(transaction.id, {
      status: TransactionStatus.SUCCESSFUL,
      verifiedAt: new Date(),
      ...(token && transaction.bill
        ? { bill: { ...transaction.bill, token } }
        : {}),
    });
    void this.notifications.notifyTransaction(transaction, 'PAYOUT_SUCCESSFUL');
    await this.rememberRecipient(transaction);
  }

  // Auto-saves the number/meter as a bill beneficiary. Best effort: a problem
  // here must never turn a paid bill into an error.
  private async rememberRecipient(transaction: Transaction): Promise<void> {
    try {
      if (!transaction.bill || !transaction.walletId) return;
      const wallet = await this.walletsService.findById(transaction.walletId);
      if (!wallet) return;
      await this.billBeneficiaries.recordSuccess(
        wallet.userId,
        transaction.bill,
        transaction.amount,
      );
    } catch (err) {
      this.logger.warn(
        `Could not save bill beneficiary for ${transaction.id}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Asks VFD where a bill payment stands and applies the answer. Used by the
   * re-query worker; safe to call repeatedly.
   */
  async syncBillStatus(
    transactionId: string,
  ): Promise<
    'NOT_FOUND' | 'ALREADY_FINAL' | 'SUCCESSFUL' | 'FAILED' | 'UNRESOLVED'
  > {
    const transaction = await this.transactionsRepo.findOneBy({
      id: transactionId,
    });
    if (!transaction || !transaction.bill) return 'NOT_FOUND';
    if (
      transaction.status === TransactionStatus.SUCCESSFUL ||
      transaction.status === TransactionStatus.FAILED
    ) {
      return 'ALREADY_FINAL';
    }

    const result = await this.registry
      .getBillsProvider()
      .queryBillStatus(transaction.reference);
    await this.transactionsRepo.update(transactionId, {
      providerStatusCode: result.providerStatusCode,
      rawPayload: (result.rawPayload ?? transaction.rawPayload) as never,
    });

    if (result.outcome === 'SUCCESSFUL') {
      await this.markSuccessful(transaction, result.token);
      return 'SUCCESSFUL';
    }
    if (result.outcome === 'FAILED') {
      await this.reverseFailedBill(transactionId);
      return 'FAILED';
    }
    return 'UNRESOLVED';
  }

  // Idempotent: re-reads the transaction inside the lock and no-ops if it is
  // already terminal, so the sync and requery paths can't double-refund.
  async reverseFailedBill(transactionId: string): Promise<void> {
    let reversed: Transaction | null = null;
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
      const refund = new Decimal(transaction.amount).plus(
        new Decimal(transaction.fee ?? '0'),
      );
      const wallet = await this.walletsService.creditForUpdate(
        manager,
        transaction.walletId as string,
        refund,
      );
      await manager.update(Transaction, transaction.id, {
        status: TransactionStatus.FAILED,
        verifiedAt: new Date(),
      });
      await manager.save(
        Transaction,
        manager.create(Transaction, {
          walletId: transaction.walletId,
          currency: transaction.currency,
          type: TransactionType.CREDIT,
          kind: TransactionKind.REVERSAL,
          status: TransactionStatus.SUCCESSFUL,
          provider: transaction.provider,
          accountNumber: transaction.accountNumber,
          amount: refund.toFixed(4),
          balanceAfter: wallet.balance,
          reference: `REV-${transaction.reference}`,
          narration: `Reversal for failed bill payment ${transaction.reference}`,
          verifiedAt: new Date(),
        }),
      );
      reversed = transaction;
      this.logger.warn(
        `Reversed failed bill payment ${transaction.reference} (transaction ${transaction.id})`,
      );
    });
    if (reversed) {
      void this.notifications.notifyTransaction(reversed, 'PAYOUT_FAILED');
    }
  }

  // "ADLB123456789" — wallet-name prefix (VFD wants one) + "B" + 9 digits.
  private async generateReference(walletName: string): Promise<string> {
    const provider = this.registry.getProviderForCurrency(CurrencyCode.NGN).key;
    for (let attempt = 0; attempt < 10; attempt++) {
      const digits = String(randomInt(0, 1_000_000_000)).padStart(9, '0');
      const reference = `${walletName}B${digits}`;
      if (!(await this.transactionsRepo.existsBy({ provider, reference }))) {
        return reference;
      }
    }
    throw new Error('Could not generate a unique transaction reference');
  }
}
