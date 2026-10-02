import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// SUPER_ADMIN: everything, incl. managing staff.
// COMPLIANCE: users + KYC review + suspend/reactivate.
// SUPPORT: read users/transactions/wallets, no state changes.
// FINANCE: read transactions/wallets/metrics, no state changes.
export enum StaffRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  COMPLIANCE = 'COMPLIANCE',
  SUPPORT = 'SUPPORT',
  FINANCE = 'FINANCE',
}

export enum StaffStatus {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

@Entity('staff_users')
export class StaffUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'full_name' })
  fullName: string;

  @Index({ unique: true })
  @Column()
  email: string;

  @Column({ name: 'password_hash' })
  passwordHash: string;

  @Column({ type: 'enum', enum: StaffRole })
  role: StaffRole;

  @Column({ type: 'enum', enum: StaffStatus, default: StaffStatus.ACTIVE })
  status: StaffStatus;

  // Set for accounts created with a temporary password (seed / invited by a
  // super admin) — the console forces a change before anything else works.
  @Column({ name: 'must_change_password', default: true })
  mustChangePassword: boolean;

  @Column({ name: 'failed_login_attempts', type: 'int', default: 0 })
  failedLoginAttempts: number;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
