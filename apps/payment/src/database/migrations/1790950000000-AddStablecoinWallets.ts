import { MigrationInterface, QueryRunner } from 'typeorm';

// USDC/USDT wallets on StableStack: the new currencies and provider, 8 decimal
// places for amounts (StableStack sends 8), and one StableStack customer per user.
export class AddStablecoinWallets1790950000000 implements MigrationInterface {
  name = 'AddStablecoinWallets1790950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const type of [
      'wallets_currency_enum',
      'transactions_currency_enum',
    ]) {
      await queryRunner.query(
        `ALTER TYPE "${type}" ADD VALUE IF NOT EXISTS 'USDC'`,
      );
      await queryRunner.query(
        `ALTER TYPE "${type}" ADD VALUE IF NOT EXISTS 'USDT'`,
      );
    }
    for (const type of [
      'addresses_provider_enum',
      'transactions_provider_enum',
    ]) {
      await queryRunner.query(
        `ALTER TYPE "${type}" ADD VALUE IF NOT EXISTS 'STABLESTACK'`,
      );
    }

    await queryRunner.query(
      `ALTER TABLE "wallets" ALTER COLUMN "balance" TYPE numeric(20,8)`,
    );
    await queryRunner.query(`
      ALTER TABLE "transactions"
        ALTER COLUMN "amount" TYPE numeric(20,8),
        ALTER COLUMN "fee" TYPE numeric(20,8),
        ALTER COLUMN "fee_vat" TYPE numeric(20,8),
        ALTER COLUMN "stamp_duty" TYPE numeric(20,8),
        ALTER COLUMN "balance_after" TYPE numeric(20,8)
    `);

    await queryRunner.query(`
      CREATE TABLE "stablestack_customers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "stablestack_customer_id" character varying NOT NULL,
        "compliance" jsonb NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_stablestack_customers_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_stablestack_customers_user_id" UNIQUE ("user_id"),
        CONSTRAINT "UQ_stablestack_customers_customer_id" UNIQUE ("stablestack_customer_id")
      )
    `);
  }

  // Postgres can't drop enum values; USDC/USDT/STABLESTACK stay on the types.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "stablestack_customers"`);
    await queryRunner.query(`
      ALTER TABLE "transactions"
        ALTER COLUMN "amount" TYPE numeric(15,4),
        ALTER COLUMN "fee" TYPE numeric(15,4),
        ALTER COLUMN "fee_vat" TYPE numeric(15,4),
        ALTER COLUMN "stamp_duty" TYPE numeric(15,4),
        ALTER COLUMN "balance_after" TYPE numeric(15,4)
    `);
    await queryRunner.query(
      `ALTER TABLE "wallets" ALTER COLUMN "balance" TYPE numeric(15,4)`,
    );
  }
}
