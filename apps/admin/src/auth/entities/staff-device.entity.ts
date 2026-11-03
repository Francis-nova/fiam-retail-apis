import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// PENDING: registered from a sign-in, waiting for a super admin.
// ACTIVE: may sign in. REVOKED: kept for the audit trail, never counts again.
export enum DeviceStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  REVOKED = 'REVOKED',
}

// A passkey (WebAuthn credential) bound to one staff member's device.
@Entity('staff_devices')
export class StaffDevice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'staff_id', type: 'uuid' })
  staffId: string;

  @Column()
  label: string;

  @Index({ unique: true })
  @Column({ name: 'credential_id' })
  credentialId: string;

  // base64url of the COSE public key.
  @Column({ name: 'public_key', type: 'text' })
  publicKey: string;

  @Column({ type: 'bigint', default: 0 })
  counter: string;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  transports: string[];

  @Column({ type: 'enum', enum: DeviceStatus })
  status: DeviceStatus;

  @Column({ name: 'approved_by', type: 'uuid', nullable: true })
  approvedBy: string | null;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  lastUsedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
