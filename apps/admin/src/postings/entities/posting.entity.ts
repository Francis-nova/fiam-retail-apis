import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum PostingType {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}

// PENDING: requested, waiting for a different staff member to decide.
// PROCESSING: approved and being applied — also the state left behind if the
//   payment service didn't answer, so the same approver can safely retry (the
//   payment call is idempotent on the posting's reference).
// POSTED / REJECTED / CANCELLED / FAILED: terminal.
export enum PostingStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  POSTED = 'POSTED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
  FAILED = 'FAILED',
}

// Maker-checker record for a manual wallet posting. The money only moves in
// the payment service, after approval; this row is the request, the decision
// and who made each.
@Entity('postings')
export class Posting {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'customer_id', type: 'uuid' })
  customerId: string;

  @Column({ name: 'wallet_id', type: 'uuid' })
  walletId: string;

  // Set when this posting resolves an UNMATCHED deposit (the credit is then
  // applied to that very transaction instead of creating a new one).
  @Column({ name: 'source_transaction_id', type: 'uuid', nullable: true })
  sourceTransactionId: string | null;

  @Column({ type: 'varchar', length: 8 })
  currency: string;

  @Column({ type: 'enum', enum: PostingType })
  type: PostingType;

  @Column({ type: 'numeric', precision: 15, scale: 4 })
  amount: string;

  // Internal justification — shown in the console, never to the customer.
  @Column({ type: 'text' })
  reason: string;

  // What the customer sees on their statement and receipt.
  @Column({ type: 'varchar', length: 100 })
  narration: string;

  @Index()
  @Column({ type: 'enum', enum: PostingStatus, default: PostingStatus.PENDING })
  status: PostingStatus;

  @Column({ name: 'requested_by_id', type: 'uuid' })
  requestedById: string;

  @Column({ name: 'requested_by_email', type: 'varchar' })
  requestedByEmail: string;

  @Column({ name: 'decided_by_id', type: 'uuid', nullable: true })
  decidedById: string | null;

  @Column({ name: 'decided_by_email', type: 'varchar', nullable: true })
  decidedByEmail: string | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ name: 'decision_note', type: 'text', nullable: true })
  decisionNote: string | null;

  // Set once the payment service has applied it.
  @Column({ name: 'transaction_id', type: 'uuid', nullable: true })
  transactionId: string | null;

  @Column({
    name: 'balance_after',
    type: 'numeric',
    precision: 15,
    scale: 4,
    nullable: true,
  })
  balanceAfter: string | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
