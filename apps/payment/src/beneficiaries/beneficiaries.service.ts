import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CurrencyCode } from '@app/common';
import { PaymentProviderKey } from '../wallets/entities/address.entity';
import { Beneficiary } from './entities/beneficiary.entity';

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

  findAllForUser(userId: string): Promise<Beneficiary[]> {
    return this.beneficiariesRepo.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
    });
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
