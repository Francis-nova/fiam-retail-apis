import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { PaymentProviderKey } from '../../wallets/entities/address.entity';

// Audit log of every provider webhook we receive, written before any
// verification so a rejected/forged/failed delivery is still on record.
// `verified` flips to true (and `verifiedAt` is stamped) only once the
// provider's own TSQ has confirmed the event; a row that stays false was
// either rejected (see `verificationNote`) or is awaiting a redelivery.
// Redeliveries of the same reference each get their own row.
@Entity('webhook_events')
@Index(['provider', 'reference'])
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  provider: PaymentProviderKey;

  @Column({ name: 'event_type', type: 'varchar' })
  eventType: string;

  @Column({ type: 'varchar', nullable: true })
  reference: string | null;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ type: 'boolean', default: false })
  verified: boolean;

  @Column({ name: 'verified_at', type: 'timestamptz', nullable: true })
  verifiedAt: Date | null;

  // Why verification did not succeed (mismatch details, TSQ status, ...).
  @Column({ name: 'verification_note', type: 'text', nullable: true })
  verificationNote: string | null;

  // Raw TSQ response the verification decision was based on.
  @Column({ name: 'tsq_payload', type: 'jsonb', nullable: true })
  tsqPayload: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
