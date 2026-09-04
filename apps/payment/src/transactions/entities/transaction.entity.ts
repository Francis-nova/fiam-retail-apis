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
import { CurrencyCode } from '@app/common';
import { PaymentProviderKey } from '../../wallets/entities/address.entity';
import { Beneficiary } from '../../beneficiaries/entities/beneficiary.entity';

export enum TransactionType {
  CREDIT = 'CREDIT',
  DEBIT = 'DEBIT',
}

// PENDING: recorded, resolved to a wallet, queued for the BullMQ worker.
// PROCESSING: the worker has picked the job up and is crediting/debiting.
// SUCCESSFUL / FAILED: terminal — verifiedAt gets set the moment either is
// reached. UNMATCHED: terminal, distinct from FAILED — the provider's
// account_number didn't resolve to any of our addresses at all, so there
// was never a wallet to credit (not a processing failure).
export enum TransactionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  SUCCESSFUL = 'SUCCESSFUL',
  FAILED = 'FAILED',
  UNMATCHED = 'UNMATCHED',
}

// Single source of truth for a payment event, from first sight (a payin
// webhook) through to its final state — supersedes what used to be two
// separate tables (an append-only ledger + a webhook-delivery audit log).
// Folding them together means the dedupe key, the audit trail, and the
// financial record are the same row, which is what lets the BullMQ worker
// (see transactions.processor.ts) safely retry without any risk of
// double-crediting: it's re-processing the same row, not re-inserting one.
@Entity('transactions')
@Index(['provider', 'reference'], { unique: true })
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Nullable — an UNMATCHED payin (provider account_number didn't resolve
  // to any address of ours) has no wallet to attach to, but we still want
  // the row for audit/reconciliation.
  @Index()
  @Column({ name: 'wallet_id', type: 'uuid', nullable: true })
  walletId: string | null;

  @Column({ type: 'enum', enum: CurrencyCode })
  currency: CurrencyCode;

  @Column({ type: 'enum', enum: TransactionType })
  type: TransactionType;

  @Index()
  @Column({ type: 'enum', enum: TransactionStatus })
  status: TransactionStatus;

  @Column({ type: 'enum', enum: PaymentProviderKey })
  provider: PaymentProviderKey;

  // The account the payment landed on/left from, as reported by the
  // provider — kept even when it doesn't resolve to any Address (that's
  // exactly the UNMATCHED case) since it's the only lead for manual
  // reconciliation.
  @Column({ name: 'account_number', type: 'varchar' })
  accountNumber: string;

  @Column({ name: 'amount', type: 'numeric', precision: 15, scale: 4 })
  amount: string;

  // The transfer fee charged on top of amount for a DEBIT (payout) —
  // wallet's actual debit is amount + fee, while amount alone is what
  // reaches the recipient. Null for CREDIT rows and for any DEBIT
  // predating this column. See payouts/fee.util.ts.
  @Column({
    name: 'fee',
    type: 'numeric',
    precision: 15,
    scale: 4,
    nullable: true,
  })
  fee: string | null;

  // Set for DEBIT (payout) transactions — links to the saved recipient this
  // payout went to. Null for CREDIT (payin) transactions, which have no
  // beneficiary concept. See beneficiaries/entities/beneficiary.entity.ts.
  @Column({ name: 'beneficiary_id', type: 'uuid', nullable: true })
  beneficiaryId: string | null;

  // Loaded via `relations: ['beneficiary']` where needed (e.g. the
  // transactions list/detail endpoints, to show who a payout went to) —
  // most call sites (PayoutsService, the processors) only ever touch the
  // plain `beneficiaryId` column above.
  @ManyToOne(() => Beneficiary, { nullable: true })
  @JoinColumn({ name: 'beneficiary_id' })
  beneficiary: Beneficiary | null;

  // Set only once the worker has actually applied the credit/debit —
  // null for PENDING/PROCESSING/FAILED/UNMATCHED.
  @Column({
    name: 'balance_after',
    type: 'numeric',
    precision: 15,
    scale: 4,
    nullable: true,
  })
  balanceAfter: string | null;

  // Provider's own reference for this transaction — this is the dedupe
  // key (see the unique index above), since a provider can redeliver the
  // same event (VFD has an explicit "retrigger webhook" endpoint).
  @Column({ type: 'varchar', length: 50 })
  reference: string;

  // A second provider-supplied identifier where one exists (e.g. VFD's
  // session_id) — kept separately from `reference` since providers don't
  // guarantee the two mean the same thing, purely for cross-referencing
  // against the provider's own dashboard/support tickets.
  @Column({
    name: 'external_id',
    type: 'varchar',
    nullable: true,
    unique: true,
  })
  externalId: string | null;

  // Raw provider status code — the /transfer response's top-level `status`
  // or TSQ's `transactionStatus` for a payout, kept for audit/support-
  // escalation purposes even though the resolved `status` column above is
  // what actually drives behavior (see vfd-transfer-codes.ts). Null for
  // payins, which don't go through this code table.
  @Column({ name: 'provider_status_code', type: 'varchar', nullable: true })
  providerStatusCode: string | null;

  @Column({ type: 'varchar', nullable: true, length: 255 })
  narration: string | null;

  // The provider's own timestamp for when the transaction happened —
  // distinct from createdAt (when we first saw it) and verifiedAt (when
  // we finished processing it).
  @Column({ name: 'occurred_at', type: 'timestamptz', nullable: true })
  occurredAt: Date | null;

  // Set the moment status becomes terminal (SUCCESSFUL, FAILED, or
  // UNMATCHED) — null while PENDING/PROCESSING.
  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  // Full raw provider payload, for audit/replay — same escape hatch as
  // Address.providerMetadata, justified for the same reason (third-party
  // response/payload shapes drift independently of our schema).
  @Column({ name: 'raw_payload', type: 'jsonb', nullable: true })
  rawPayload: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
