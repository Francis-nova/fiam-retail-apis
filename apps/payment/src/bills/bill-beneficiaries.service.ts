import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  BillDetails,
  BillType,
  billTypeFromCategory,
} from '../transactions/entities/transaction.entity';
import { BillBeneficiary } from './entities/bill-beneficiary.entity';

@Injectable()
export class BillBeneficiariesService {
  constructor(
    @InjectRepository(BillBeneficiary)
    private readonly repo: Repository<BillBeneficiary>,
  ) {}

  // Called when a bill payment succeeds. Upserts on (user, biller, customer):
  // a repeat bumps the count and remembers the latest plan/amount, but never
  // touches the nickname or the dismissed flag.
  async recordSuccess(
    userId: string,
    bill: BillDetails,
    amount: string,
  ): Promise<void> {
    await this.repo.query(
      `INSERT INTO "bill_beneficiaries"
         ("user_id","bill_type","biller_id","biller_name","division","product_id",
          "customer_id","last_payment_item","last_payment_item_name","last_amount",
          "pay_count","last_paid_at")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,now())
       ON CONFLICT ("user_id","biller_id","division","product_id","customer_id")
       DO UPDATE SET
         "biller_name" = EXCLUDED."biller_name",
         "bill_type" = EXCLUDED."bill_type",
         "last_payment_item" = EXCLUDED."last_payment_item",
         "last_payment_item_name" = EXCLUDED."last_payment_item_name",
         "last_amount" = EXCLUDED."last_amount",
         "pay_count" = "bill_beneficiaries"."pay_count" + 1,
         "last_paid_at" = now(),
         "updated_at" = now()`,
      [
        userId,
        billTypeFromCategory(bill.category),
        bill.billerId,
        bill.billerName,
        bill.division,
        bill.productId,
        bill.customerId,
        bill.paymentItem,
        bill.paymentItemName,
        amount,
      ],
    );
  }

  // Saved (nicknamed) first, then recents by most recent payment.
  list(userId: string, billType?: BillType): Promise<BillBeneficiary[]> {
    const query = this.repo
      .createQueryBuilder('b')
      .where('b.userId = :userId AND b.dismissed = false', { userId });
    if (billType) query.andWhere('b.billType = :billType', { billType });
    return query
      .orderBy('(b.nickname IS NULL)', 'ASC')
      .addOrderBy('b.lastPaidAt', 'DESC')
      .limit(30)
      .getMany();
  }

  private async findOwned(
    userId: string,
    id: string,
  ): Promise<BillBeneficiary> {
    const found = await this.repo.findOne({
      where: { id, userId, dismissed: false },
    });
    if (!found) throw new NotFoundException('Beneficiary not found');
    return found;
  }

  // Blank clears the nickname (the entry falls back to a plain recent).
  async rename(
    userId: string,
    id: string,
    nickname: string,
  ): Promise<BillBeneficiary> {
    const found = await this.findOwned(userId, id);
    found.nickname = nickname.trim() === '' ? null : nickname.trim();
    return this.repo.save(found);
  }

  async dismiss(userId: string, id: string): Promise<void> {
    const found = await this.findOwned(userId, id);
    await this.repo.update(found.id, { dismissed: true, nickname: null });
  }
}
