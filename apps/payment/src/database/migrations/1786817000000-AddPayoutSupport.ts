import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds NGN payout support: a `beneficiaries` table (see
// beneficiaries/entities/beneficiary.entity.ts — saved recipients, upserted
// on every initiated payout) and two new columns on the existing
// `transactions` table for the DEBIT/payout lifecycle: `beneficiary_id`
// (links a payout to the recipient it went to) and `provider_status_code`
// (the raw VFD code — transfer-response or TSQ transactionStatus — kept for
// audit/support-escalation purposes, see vfd-transfer-codes.ts).
export class AddPayoutSupport1786817000000 implements MigrationInterface {
  name = 'AddPayoutSupport1786817000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "beneficiaries_currency_enum" AS ENUM ('NGN')
    `);
    await queryRunner.query(`
      CREATE TYPE "beneficiaries_provider_enum" AS ENUM ('VFD')
    `);
    await queryRunner.query(`
      CREATE TABLE "beneficiaries" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "currency" "beneficiaries_currency_enum" NOT NULL,
        "provider" "beneficiaries_provider_enum" NOT NULL,
        "bank_code" character varying NOT NULL,
        "bank_name" character varying,
        "account_number" character varying NOT NULL,
        "account_name" character varying,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_beneficiaries" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_beneficiaries_user_provider_bank_account" UNIQUE ("user_id", "provider", "bank_code", "account_number")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_beneficiaries_user_id" ON "beneficiaries" ("user_id")`,
    );

    await queryRunner.query(`
      ALTER TABLE "transactions" ADD COLUMN "beneficiary_id" uuid
    `);
    await queryRunner.query(`
      ALTER TABLE "transactions"
        ADD CONSTRAINT "FK_transactions_beneficiary"
        FOREIGN KEY ("beneficiary_id") REFERENCES "beneficiaries" ("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "transactions" ADD COLUMN "provider_status_code" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "provider_status_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP CONSTRAINT "FK_transactions_beneficiary"`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "beneficiary_id"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_beneficiaries_user_id"`);
    await queryRunner.query(`DROP TABLE "beneficiaries"`);
    await queryRunner.query(`DROP TYPE "beneficiaries_provider_enum"`);
    await queryRunner.query(`DROP TYPE "beneficiaries_currency_enum"`);
  }
}
