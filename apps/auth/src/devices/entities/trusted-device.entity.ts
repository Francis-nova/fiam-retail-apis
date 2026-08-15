import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

// A device becomes trusted the moment its owner proves themselves on it via
// a strong factor — completing the signup wizard (email/phone/BVN all
// verified) or confirming the transaction PIN during a login challenge. Once
// trusted, that deviceId skips the PIN step on future logins.
@Entity('trusted_devices')
@Index(['userId', 'deviceId'], { unique: true })
export class TrustedDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'device_id' })
  deviceId: string;

  @Column({ name: 'device_name', type: 'varchar', nullable: true })
  deviceName: string | null;

  @Column({ name: 'trusted_at', type: 'timestamptz' })
  trustedAt: Date;

  @Column({ name: 'last_seen_at', type: 'timestamptz' })
  lastSeenAt: Date;

  // Biometric preferences are inherently per-device (Face/Touch ID is
  // enrolled per device, not per account) — actual biometric prompting
  // happens client-side; these flags are the record of consent/capability.
  @Column({ name: 'biometric_login_enabled', default: false })
  biometricLoginEnabled: boolean;

  @Column({ name: 'biometric_transaction_enabled', default: false })
  biometricTransactionEnabled: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
