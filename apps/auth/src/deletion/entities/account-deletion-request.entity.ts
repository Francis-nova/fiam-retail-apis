import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum DeletionRequestStatus {
  PENDING = 'PENDING',
  // Staff approved it and the account was closed.
  COMPLETED = 'COMPLETED',
  REJECTED = 'REJECTED',
  // The customer withdrew it before staff decided.
  CANCELLED = 'CANCELLED',
}

@Entity('account_deletion_requests')
export class AccountDeletionRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  // Why the customer says they're leaving (optional, free text).
  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Index()
  @Column({
    type: 'enum',
    enum: DeletionRequestStatus,
    default: DeletionRequestStatus.PENDING,
  })
  status: DeletionRequestStatus;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  // Staff email as plain text — staff live in a different database.
  @Column({ name: 'decided_by_email', type: 'varchar', nullable: true })
  decidedByEmail: string | null;

  // Shown to the customer when a request is rejected.
  @Column({ name: 'decision_note', type: 'text', nullable: true })
  decisionNote: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
