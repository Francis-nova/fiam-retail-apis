import { MigrationInterface, QueryRunner } from 'typeorm';

// Folds what used to be two separate tables (wallet_transactions, an
// append-only ledger, and provider_webhook_events, a webhook-delivery audit
// log) into a single `transactions` table with a real status lifecycle
// (PENDING -> PROCESSING -> SUCCESSFUL/FAILED/UNMATCHED), driven by the new
// BullMQ-based transaction processor. See transactions/entities/transaction.entity.ts.
export class ReplaceLedgerWithTransactions1786816000000 implements MigrationInterface {
  name = 'ReplaceLedgerWithTransactions1786816000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the two tables being replaced, in FK-dependency order.
    await queryRunner.query(`
      ALTER TABLE "wallet_transactions" DROP CONSTRAINT "FK_wallet_transactions_webhook_event"
    `);
    await queryRunner.query(`DROP TABLE "provider_webhook_events"`);
    await queryRunner.query(`DROP TYPE "provider_webhook_events_status_enum"`);
    await queryRunner.query(
      `DROP TYPE "provider_webhook_events_provider_enum"`,
    );
    await queryRunner.query(`DROP TABLE "wallet_transactions"`);
    await queryRunner.query(`DROP TYPE "wallet_transactions_source_enum"`);
    await queryRunner.query(`DROP TYPE "wallet_transactions_type_enum"`);

    // transactions
    await queryRunner.query(`
      CREATE TYPE "transactions_currency_enum" AS ENUM ('NGN')
    `);
    await queryRunner.query(`
      CREATE TYPE "transactions_type_enum" AS ENUM ('CREDIT', 'DEBIT')
    `);
    await queryRunner.query(`
      CREATE TYPE "transactions_status_enum" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESSFUL', 'FAILED', 'UNMATCHED')
    `);
    await queryRunner.query(`
      CREATE TYPE "transactions_provider_enum" AS ENUM ('VFD')
    `);
    await queryRunner.query(`
      CREATE TABLE "transactions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "wallet_id" uuid,
        "currency" "transactions_currency_enum" NOT NULL,
        "type" "transactions_type_enum" NOT NULL,
        "status" "transactions_status_enum" NOT NULL,
        "provider" "transactions_provider_enum" NOT NULL,
        "account_number" character varying NOT NULL,
        "amount_minor" bigint NOT NULL,
        "balance_after_minor" bigint,
        "reference" character varying NOT NULL,
        "external_id" character varying,
        "narration" character varying,
        "occurred_at" TIMESTAMP WITH TIME ZONE,
        "verified_at" TIMESTAMP WITH TIME ZONE,
        "raw_payload" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_transactions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_transactions_provider_reference" UNIQUE ("provider", "reference"),
        CONSTRAINT "FK_transactions_wallet" FOREIGN KEY ("wallet_id") REFERENCES "wallets" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_transactions_wallet_id" ON "transactions" ("wallet_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_transactions_status" ON "transactions" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "transactions"`);
    await queryRunner.query(`DROP TYPE "transactions_provider_enum"`);
    await queryRunner.query(`DROP TYPE "transactions_status_enum"`);
    await queryRunner.query(`DROP TYPE "transactions_type_enum"`);
    await queryRunner.query(`DROP TYPE "transactions_currency_enum"`);

    // Recreate the two tables exactly as InitPaymentSchema originally did.
    await queryRunner.query(`
      CREATE TYPE "wallet_transactions_type_enum" AS ENUM ('CREDIT', 'DEBIT')
    `);
    await queryRunner.query(`
      CREATE TYPE "wallet_transactions_source_enum" AS ENUM ('VFD_INWARD_CREDIT')
    `);
    await queryRunner.query(`
      CREATE TABLE "wallet_transactions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "wallet_id" uuid NOT NULL,
        "type" "wallet_transactions_type_enum" NOT NULL,
        "source" "wallet_transactions_source_enum" NOT NULL,
        "amount_minor" bigint NOT NULL,
        "balance_after_minor" bigint NOT NULL,
        "external_reference" character varying NOT NULL,
        "narration" character varying,
        "webhook_event_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wallet_transactions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_wallet_transactions_wallet" FOREIGN KEY ("wallet_id") REFERENCES "wallets" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_wallet_transactions_wallet_id" ON "wallet_transactions" ("wallet_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_wallet_transactions_external_reference" ON "wallet_transactions" ("external_reference")`,
    );

    await queryRunner.query(`
      CREATE TYPE "provider_webhook_events_provider_enum" AS ENUM ('VFD')
    `);
    await queryRunner.query(`
      CREATE TYPE "provider_webhook_events_status_enum" AS ENUM ('PROCESSED', 'UNMATCHED', 'FAILED')
    `);
    await queryRunner.query(`
      CREATE TABLE "provider_webhook_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "provider" "provider_webhook_events_provider_enum" NOT NULL,
        "event_type" character varying NOT NULL,
        "external_reference" character varying NOT NULL,
        "session_id" character varying,
        "account_number" character varying NOT NULL,
        "amount_minor" bigint NOT NULL,
        "payload" jsonb NOT NULL,
        "status" "provider_webhook_events_status_enum" NOT NULL,
        "address_id" uuid,
        "wallet_transaction_id" uuid,
        "received_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "processed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_provider_webhook_events" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_provider_webhook_events_provider_reference" UNIQUE ("provider", "external_reference"),
        CONSTRAINT "FK_provider_webhook_events_address" FOREIGN KEY ("address_id") REFERENCES "addresses" ("id") ON DELETE SET NULL,
        CONSTRAINT "FK_provider_webhook_events_wallet_transaction" FOREIGN KEY ("wallet_transaction_id") REFERENCES "wallet_transactions" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_provider_webhook_events_received_at" ON "provider_webhook_events" ("received_at")`,
    );
    await queryRunner.query(`
      ALTER TABLE "wallet_transactions"
        ADD CONSTRAINT "FK_wallet_transactions_webhook_event"
        FOREIGN KEY ("webhook_event_id") REFERENCES "provider_webhook_events" ("id") ON DELETE SET NULL
    `);
  }
}
