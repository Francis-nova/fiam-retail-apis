import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum BroadcastStatus {
  QUEUED = 'QUEUED',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

// A staff-composed push/email message to all customers or a chosen few. The
// row is the request and its progress; the fan-out runs in a queue worker.
@Entity('broadcasts')
export class Broadcast {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', array: true })
  channels: Array<'push' | 'email'>;

  @Column()
  title: string;

  @Column({ type: 'text' })
  body: string;

  // Null means every active customer.
  @Column({ name: 'customer_ids', type: 'uuid', array: true, nullable: true })
  customerIds: string[] | null;

  @Column({
    type: 'enum',
    enum: BroadcastStatus,
    default: BroadcastStatus.QUEUED,
  })
  status: BroadcastStatus;

  @Column({ name: 'recipient_count', type: 'int', default: 0 })
  recipientCount: number;

  // Messages handed to postoffice (not delivered: delivery is per provider).
  @Column({ name: 'published_count', type: 'int', default: 0 })
  publishedCount: number;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;
}
