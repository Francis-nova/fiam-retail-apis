import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CurrencyCode } from '@app/common';
import { PaymentProviderKey } from '../../wallets/entities/address.entity';

// A saved payout recipient — every successfully-initiated payout upserts
// one of these (see PayoutsService.initiatePayout), so the next payout to
// the same account doesn't require re-entering/re-verifying bank details.
// Deliberately doesn't cache the provider-specific transfer-resolution
// fields (clientId, savingsId/accountId, session) — those are re-fetched
// fresh via lookupTransferRecipient() at transfer time regardless, per
// VFD's own documented flow, since they can be short-lived/session-scoped.
@Entity('beneficiaries')
@Index(['userId', 'provider', 'bankCode', 'accountNumber'], { unique: true })
export class Beneficiary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // No FK — `users` lives in the separate fiam_auth database, same
  // convention as Wallet.userId.
  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'enum', enum: CurrencyCode })
  currency: CurrencyCode;

  @Column({ type: 'enum', enum: PaymentProviderKey })
  provider: PaymentProviderKey;

  @Column({ name: 'bank_code', type: 'varchar' })
  bankCode: string;

  @Column({ name: 'bank_name', type: 'varchar', nullable: true })
  bankName: string | null;

  @Column({ name: 'account_number', type: 'varchar' })
  accountNumber: string;

  @Column({ name: 'account_name', type: 'varchar', nullable: true })
  accountName: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Bumped on every reuse (see BeneficiariesService.upsert) — doubles as
  // "last used at" for a future "recent beneficiaries" sort.
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
