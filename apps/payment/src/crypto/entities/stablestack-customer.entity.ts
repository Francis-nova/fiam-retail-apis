import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { ComplianceAnswers } from '../dto/create-crypto-wallet.dto';

// One StableStack customer per Fiam user, created the first time they create
// a stablecoin wallet. `compliance` holds the answers they gave then; they go
// to StableStack when the full profile is needed (NGN payouts, phase 3).
@Entity('stablestack_customers')
export class StableStackCustomer {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId!: string;

  @Column({ name: 'stablestack_customer_id', type: 'varchar', unique: true })
  stablestackCustomerId!: string;

  @Column({ type: 'jsonb' })
  compliance!: ComplianceAnswers;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
