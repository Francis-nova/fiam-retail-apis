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

// Issued in place of real tokens when /auth/login succeeds on a device that
// isn't yet trusted for that user — the client must exchange it for a real
// token pair via /auth/login/pin within its TTL. Request metadata is
// captured here at login time so the eventual Session row reflects the
// device that actually authenticated, not whatever the PIN-confirm request
// happens to send.
@Entity('pending_logins')
export class PendingLogin {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // sha256 of the raw ticket handed to the client — the raw value is never persisted.
  @Index({ unique: true })
  @Column({ name: 'ticket_hash' })
  ticketHash: string;

  @Column({ name: 'device_id', type: 'varchar', nullable: true })
  deviceId: string | null;

  @Column({ name: 'device_name', type: 'varchar', nullable: true })
  deviceName: string | null;

  @Column({ name: 'user_agent', type: 'varchar', nullable: true })
  userAgent: string | null;

  @Column({ name: 'ip_address', type: 'varchar', nullable: true })
  ipAddress: string | null;

  @Column({ default: 0 })
  attempts: number;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
