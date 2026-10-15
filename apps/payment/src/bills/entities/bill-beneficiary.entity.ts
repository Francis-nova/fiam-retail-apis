import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { BillType } from '../../transactions/entities/transaction.entity';

// A number/meter/smartcard the customer has paid a bill for, on one biller.
// Written automatically when a bill payment succeeds (never on a failed one),
// so the bills form can offer "Saved & recent". A nickname turns a recent
// into a saved one. Separate from `Beneficiary`, which is bank-account shaped.
@Entity('bill_beneficiaries')
@Index(['userId', 'billerId', 'division', 'productId', 'customerId'], {
  unique: true,
})
export class BillBeneficiary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // No FK — `users` lives in the separate fiam_auth database.
  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'bill_type', type: 'enum', enum: BillType })
  billType: BillType;

  @Column({ name: 'biller_id', type: 'varchar' })
  billerId: string;

  @Column({ name: 'biller_name', type: 'varchar' })
  billerName: string;

  @Column({ type: 'varchar' })
  division: string;

  @Column({ name: 'product_id', type: 'varchar' })
  productId: string;

  // Phone, meter or smartcard number.
  @Column({ name: 'customer_id', type: 'varchar' })
  customerId: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  nickname: string | null;

  // What was bought last time, so a repeat can preselect the plan (data,
  // cable) or prefill the amount (airtime, electricity).
  @Column({ name: 'last_payment_item', type: 'varchar' })
  lastPaymentItem: string;

  @Column({ name: 'last_payment_item_name', type: 'varchar' })
  lastPaymentItemName: string;

  @Column({ name: 'last_amount', type: 'numeric', precision: 15, scale: 4 })
  lastAmount: string;

  @Column({ name: 'pay_count', type: 'int', default: 1 })
  payCount: number;

  @Column({ name: 'last_paid_at', type: 'timestamptz' })
  lastPaidAt: Date;

  // "Removed" by the customer. Kept as a flag rather than deleted so the
  // auto-save on the next payment doesn't bring it back.
  @Column({ type: 'boolean', default: false })
  dismissed: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
