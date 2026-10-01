import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CurrencyCode } from '@app/common';
import { PaymentProviderKey } from '../wallets/entities/address.entity';
import { Beneficiary } from './entities/beneficiary.entity';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../transactions/entities/transaction.entity';

// A recipient the user has actually transferred to, with how often and when
// they last did.
export interface RecentBeneficiary {
  beneficiary: Beneficiary;
  transferCount: number;
  lastTransferAt: Date;
}

export interface UpsertBeneficiaryInput {
  userId: string;
  currency: CurrencyCode;
  provider: PaymentProviderKey;
  bankCode: string;
  bankName: string | null;
  accountNumber: string;
  accountName: string | null;
}

@Injectable()
export class BeneficiariesService {
  constructor(
    @InjectRepository(Beneficiary)
    private readonly beneficiariesRepo: Repository<Beneficiary>,
  ) {}

  // Every distinct account this user has transferred to, most recent
  // first. A beneficiary row is saved as soon as a payout is *initiated*
  // (before the money moves), so this only counts recipients with at least
  // one non-FAILED DEBIT — an attempt that failed doesn't make someone a
  // "recent recipient".
  async findAllForUser(userId: string): Promise<RecentBeneficiary[]> {
    const { raw, entities } = await this.beneficiariesRepo
      .createQueryBuilder('b')
      .innerJoin(
        Transaction,
        't',
        't.beneficiaryId = b.id AND t.type = :debit AND t.status != :failed',
        { debit: TransactionType.DEBIT, failed: TransactionStatus.FAILED },
      )
      .addSelect('COUNT(t.id)', 'transfer_count')
      .addSelect('MAX(t.createdAt)', 'last_transfer_at')
      .where('b.userId = :userId', { userId })
      .groupBy('b.id')
      .orderBy('MAX(t.createdAt)', 'DESC')
      .getRawAndEntities<{
        transfer_count: string;
        last_transfer_at: Date;
      }>();
    return entities.map((beneficiary, i) => ({
      beneficiary,
      transferCount: Number(raw[i].transfer_count),
      lastTransferAt: new Date(raw[i].last_transfer_at),
    }));
  }

  async findOwnedById(userId: string, id: string): Promise<Beneficiary> {
    const beneficiary = await this.beneficiariesRepo.findOne({
      where: { id, userId },
    });
    if (!beneficiary) {
      throw new NotFoundException('Beneficiary not found');
    }
    return beneficiary;
  }

  // Called for every initiated payout (see PayoutsService.initiatePayout) —
  // "save all payout as a beneficiary" is a hard requirement, not opt-in.
  // Upserts on (userId, provider, bankCode, accountNumber): a repeat payout
  // to the same recipient refreshes the display name and bumps updatedAt
  // rather than creating a duplicate row.
  async upsert(input: UpsertBeneficiaryInput): Promise<Beneficiary> {
    await this.beneficiariesRepo
      .createQueryBuilder()
      .insert()
      .into(Beneficiary)
      .values({ ...input, updatedAt: new Date() })
      .orUpdate(
        ['bank_name', 'account_name', 'updated_at'],
        ['user_id', 'provider', 'bank_code', 'account_number'],
      )
      .execute();
    return this.beneficiariesRepo.findOneByOrFail({
      userId: input.userId,
      provider: input.provider,
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
    });
  }
}
