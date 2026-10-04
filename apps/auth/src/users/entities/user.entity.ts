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
  // Terminal: set by the console's close-account action. Email/phone are
  // anonymized; KYC identifiers and records are retained.
  CLOSED = 'CLOSED',
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

  // National Identification Number — Tier 3 upgrade requirement, verified
  // against QoreID's NIN identity endpoint. Same "reference to an
  // already-verified identity" rationale as bvn above.
  @Index({ unique: true, where: '"nin" IS NOT NULL' })
  @Column({ type: 'varchar', nullable: true })
  nin: string | null;

  @Column({ name: 'nin_verified_at', type: 'timestamptz', nullable: true })
  ninVerifiedAt: Date | null;

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

  // Brute-force counters — see UsersService.guardedVerify.
  @Column({ name: 'password_failed_attempts', type: 'int', default: 0 })
  passwordFailedAttempts: number;

  @Column({
    name: 'password_locked_until',
    type: 'timestamptz',
    nullable: true,
  })
  passwordLockedUntil: Date | null;

  @Column({ name: 'pin_failed_attempts', type: 'int', default: 0 })
  pinFailedAttempts: number;

  @Column({ name: 'pin_locked_until', type: 'timestamptz', nullable: true })
  pinLockedUntil: Date | null;

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

  @Column({
    name: 'tier_upgrade_decided_at',
    type: 'timestamptz',
    nullable: true,
  })
  tierUpgradeDecidedAt: Date | null;

  // Shown to the customer when the upgrade is rejected.
  @Column({ name: 'tier_upgrade_decision_note', type: 'text', nullable: true })
  tierUpgradeDecisionNote: string | null;

  @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
  closedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
