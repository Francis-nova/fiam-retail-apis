import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CurrencyCode } from '@app/common';

@Entity('wallets')
@Index(['userId', 'currency'], { unique: true })
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // No FK — `users` lives in the separate fiam_auth database. Referential
  // integrity here is application-level only; the RabbitMQ provisioning
  // message's userId is the source of truth.
  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'enum', enum: CurrencyCode })
  currency: CurrencyCode;

  // Minor units (kobo for NGN) to avoid float precision issues. TypeORM
  // returns bigint columns as JS strings — keep it a string here and do all
  // arithmetic via explicit BigInt() conversions in the service layer, never
  // via +/- on the string itself.
  @Column({
    name: 'balance_minor',
    type: 'bigint',
    default: 0,
  })
  balanceMinor: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
