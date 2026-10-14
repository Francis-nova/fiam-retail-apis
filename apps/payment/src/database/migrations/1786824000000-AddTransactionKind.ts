import { MigrationInterface, QueryRunner } from 'typeorm';

// Explicit classification of every transaction (deposit / payout / bill
// payment / reversal / adjustment), plus the bill type for bill payments.
// Existing rows are backfilled from what they already record.
export class AddTransactionKind1786824000000 implements MigrationInterface {
  name = 'AddTransactionKind1786824000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "transactions_kind_enum" AS ENUM ('DEPOSIT','PAYOUT','BILL_PAYMENT','REVERSAL','ADJUSTMENT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "transactions_bill_type_enum" AS ENUM ('AIRTIME','DATA','CABLE_TV','UTILITY','INTERNET','BETTING','OTHER')`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD COLUMN "kind" "transactions_kind_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD COLUMN "bill_type" "transactions_bill_type_enum"`,
    );

    // Order matters: most specific first.
    await queryRunner.query(`
      UPDATE "transactions" SET "kind" = CASE
        WHEN "bill" IS NOT NULL THEN 'BILL_PAYMENT'
        WHEN "provider" = 'MANUAL' THEN 'ADJUSTMENT'
        WHEN "type" = 'CREDIT' AND "reference" LIKE 'REV-%' THEN 'REVERSAL'
        WHEN "type" = 'DEBIT' THEN 'PAYOUT'
        ELSE 'DEPOSIT'
      END::"transactions_kind_enum"`);
    await queryRunner.query(`
      UPDATE "transactions" SET "bill_type" = (CASE lower(trim("bill"->>'category'))
        WHEN 'airtime' THEN 'AIRTIME'
        WHEN 'data' THEN 'DATA'
        WHEN 'cable tv' THEN 'CABLE_TV'
        WHEN 'utility' THEN 'UTILITY'
        WHEN 'internet subscription' THEN 'INTERNET'
        WHEN 'betting' THEN 'BETTING'
        WHEN 'gaming' THEN 'BETTING'
        ELSE 'OTHER'
      END)::"transactions_bill_type_enum"
      WHERE "bill" IS NOT NULL`);

    await queryRunner.query(
      `ALTER TABLE "transactions" ALTER COLUMN "kind" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_transactions_kind" ON "transactions" ("kind")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_transactions_kind"`);
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "bill_type"`,
    );
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "kind"`);
    await queryRunner.query(`DROP TYPE "transactions_bill_type_enum"`);
    await queryRunner.query(`DROP TYPE "transactions_kind_enum"`);
  }
}
