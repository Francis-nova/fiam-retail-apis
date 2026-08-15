import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum UserStatus {
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}

// CBN tiered-KYC framework — every customer starts at Tier 1 on signup.
// Tier 2 is intentionally not offered as an upgrade path in this app; the
// only upgrade flow built is Tier 1 -> Tier 3.
export enum CustomerTier {
  TIER_1 = 'TIER_1',
  TIER_2 = 'TIER_2',
  TIER_3 = 'TIER_3',
}

export enum TierUpgradeStatus {
  NONE = 'NONE',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'first_name' })
  firstName: string;

  @Column({ name: 'last_name' })
  lastName: string;

  @Index({ unique: true })
  @Column()
  email: string;

  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt: Date | null;

  @Index({ unique: true, where: '"phone" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  phone: string | null;

  @Column({ name: 'phone_verified_at', type: 'timestamptz', nullable: true })
  phoneVerifiedAt: Date | null;

  // BVN is sensitive PII — stored only to reference an already-verified
  // identity, never returned in full by any API response.
  @Index({ unique: true, where: '"bvn" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  bvn: string | null;

  @Column({ name: 'bvn_verified_at', type: 'timestamptz', nullable: true })
  bvnVerifiedAt: Date | null;

  // Registered to the customer's BVN, captured from QoreID's verification
  // response — needed for VFD account provisioning, which requires bvn +
  // dateOfBirth together.
  @Column({ name: 'date_of_birth', type: 'date', nullable: true })
  dateOfBirth: string | null;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({
    type: 'enum',
    enum: UserStatus,
    default: UserStatus.PENDING_VERIFICATION,
  })
  status: UserStatus;

  @Column({ type: 'enum', enum: CustomerTier, default: CustomerTier.TIER_1 })
  tier: CustomerTier;

  // Transaction PIN — a second factor for sign-in on unrecognized devices and
  // for authorizing payouts/transfers. Hashed the same way as the login
  // password (argon2id via PasswordService); never returned by any API.
  @Column({ name: 'transaction_pin_hash', type: 'varchar', nullable: true })
  transactionPinHash: string | null;

  @Column({
    name: 'transaction_pin_set_at',
    type: 'timestamptz',
    nullable: true,
  })
  transactionPinSetAt: Date | null;

  @Column({
    name: 'tier_upgrade_status',
    type: 'enum',
    enum: TierUpgradeStatus,
    default: TierUpgradeStatus.NONE,
  })
  tierUpgradeStatus: TierUpgradeStatus;

  @Column({
    name: 'tier_upgrade_submitted_at',
    type: 'timestamptz',
    nullable: true,
  })
  tierUpgradeSubmittedAt: Date | null;

  // Idempotency guard for the payment-account provisioning RabbitMQ publish:
  // BVN-verification and PIN-set are two independent code paths, either of
  // which can be "whichever completes second" — this atomic claim (see
  // UsersService.claimPaymentAccountProvisioning) ensures only one of them
  // actually publishes, even under a race.
  @Column({
    name: 'payment_account_provisioning_requested_at',
    type: 'timestamptz',
    nullable: true,
  })
  paymentAccountProvisioningRequestedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
