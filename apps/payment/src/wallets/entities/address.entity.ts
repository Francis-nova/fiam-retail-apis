import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Wallet } from './wallet.entity';

export enum PaymentProviderKey {
  VFD = 'VFD',
}

export enum AddressStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

// An address is a specific provider account that can fund a wallet (e.g. a
// VFD sub-account). A wallet has a history of addresses — only one ACTIVE at
// a time — so switching providers (VFD -> FCMB) is: deactivate the current
// address, activate a new one on the same wallet. Balance/transaction
// history stay on the wallet and never move.
@Entity('addresses')
@Index(['provider', 'providerAccountNumber'], { unique: true })
// Partial unique index: enforces "only one ACTIVE address per wallet" —
// mirrors the partial-unique pattern already used on User.phone/User.bvn.
@Index('IDX_addresses_wallet_active', ['walletId'], {
  unique: true,
  where: `"status" = 'ACTIVE'`,
})
export class Address {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'wallet_id', type: 'uuid' })
  walletId: string;

  @ManyToOne(() => Wallet, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'wallet_id' })
  wallet: Wallet;

  @Column({ type: 'enum', enum: PaymentProviderKey })
  provider: PaymentProviderKey;

  @Column({ name: 'provider_account_number', type: 'varchar' })
  providerAccountNumber: string;

  @Column({ name: 'provider_account_name', type: 'varchar', nullable: true })
  providerAccountName: string | null;

  // VFD's own tier ("1"/"2"/"3"), stored opaque — NOT related to our
  // internal CustomerTier (apps/auth/src/users/tier-limits.ts). Never
  // interpreted, just recorded.
  @Column({ name: 'provider_tier_raw', type: 'varchar', nullable: true })
  providerTierRaw: string | null;

  // Raw remainder of the provider's response, for debugging — the one
  // deliberate JSONB escape hatch here, justified because third-party
  // response shapes drift independently of our schema.
  @Column({ name: 'provider_metadata', type: 'jsonb', nullable: true })
  providerMetadata: Record<string, unknown> | null;

  @Column({
    type: 'enum',
    enum: AddressStatus,
    default: AddressStatus.ACTIVE,
  })
  status: AddressStatus;

  @Column({ name: 'activated_at', type: 'timestamptz' })
  activatedAt: Date;

  @Column({ name: 'deactivated_at', type: 'timestamptz', nullable: true })
  deactivatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
