import { MigrationInterface, QueryRunner } from 'typeorm';

// Saved & recent bill recipients (see bills/entities/bill-beneficiary.entity.ts).
// Backfilled from bill payments that already succeeded.
export class AddBillBeneficiaries1786825000000 implements MigrationInterface {
  name = 'AddBillBeneficiaries1786825000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "bill_beneficiaries_bill_type_enum" AS ENUM ('AIRTIME','DATA','CABLE_TV','UTILITY','INTERNET','BETTING','OTHER')`,
    );
    await queryRunner.query(`
      CREATE TABLE "bill_beneficiaries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "bill_type" "bill_beneficiaries_bill_type_enum" NOT NULL,
        "biller_id" character varying NOT NULL,
        "biller_name" character varying NOT NULL,
        "division" character varying NOT NULL,
        "product_id" character varying NOT NULL,
        "customer_id" character varying NOT NULL,
        "nickname" character varying(40),
        "last_payment_item" character varying NOT NULL,
        "last_payment_item_name" character varying NOT NULL,
        "last_amount" numeric(15,4) NOT NULL,
        "pay_count" integer NOT NULL DEFAULT 1,
        "last_paid_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "dismissed" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bill_beneficiaries" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_bill_beneficiaries_user_biller_customer"
          UNIQUE ("user_id", "biller_id", "division", "product_id", "customer_id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_bill_beneficiaries_user_id" ON "bill_beneficiaries" ("user_id")`,
    );

    // Backfill: one row per (user, biller, customer) from successful bills,
    // taking the latest payment's plan/amount.
    await queryRunner.query(`
      INSERT INTO "bill_beneficiaries"
        ("user_id","bill_type","biller_id","biller_name","division","product_id",
         "customer_id","last_payment_item","last_payment_item_name","last_amount",
         "pay_count","last_paid_at")
      SELECT DISTINCT ON (w."user_id", t."bill"->>'billerId', t."bill"->>'division',
                          t."bill"->>'productId', t."bill"->>'customerId')
        w."user_id",
        t."bill_type"::text::"bill_beneficiaries_bill_type_enum",
        t."bill"->>'billerId', t."bill"->>'billerName', t."bill"->>'division',
        t."bill"->>'productId', t."bill"->>'customerId',
        t."bill"->>'paymentItem', t."bill"->>'paymentItemName', t."amount",
        COUNT(*) OVER (PARTITION BY w."user_id", t."bill"->>'billerId',
          t."bill"->>'division', t."bill"->>'productId', t."bill"->>'customerId'),
        COALESCE(t."verified_at", t."created_at")
      FROM "transactions" t
      JOIN "wallets" w ON w."id" = t."wallet_id"
      WHERE t."kind" = 'BILL_PAYMENT' AND t."status" = 'SUCCESSFUL'
        AND t."bill" IS NOT NULL AND t."bill_type" IS NOT NULL
      ORDER BY w."user_id", t."bill"->>'billerId', t."bill"->>'division',
               t."bill"->>'productId', t."bill"->>'customerId',
               COALESCE(t."verified_at", t."created_at") DESC`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_bill_beneficiaries_user_id"`);
    await queryRunner.query(`DROP TABLE "bill_beneficiaries"`);
    await queryRunner.query(`DROP TYPE "bill_beneficiaries_bill_type_enum"`);
  }
}
