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
  id!: string;

  // No FK — `users` lives in the separate fiam_auth database. Referential
  // integrity here is application-level only; the RabbitMQ provisioning
  // message's userId is the source of truth.
  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'enum', enum: CurrencyCode })
  currency!: CurrencyCode;

  // Decimal in the wallet's currency (8 places, for stablecoins). Postgres numeric is exact, but JS Number/native +/- are
  // not — TypeORM returns numeric columns as JS strings, and all arithmetic
  // must go through decimal.js (`new Decimal(wallet.balance)`) in the
  // service layer, never raw string/Number math.
  @Column({
    name: 'balance',
    type: 'numeric',
    precision: 20,
    scale: 8,
    default: 0,
  })
  balance!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
