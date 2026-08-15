import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitPaymentSchema1786815000000 implements MigrationInterface {
  name = 'InitPaymentSchema1786815000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // wallets
    await queryRunner.query(`
      CREATE TYPE "wallets_currency_enum" AS ENUM ('NGN')
    `);
    await queryRunner.query(`
      CREATE TABLE "wallets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "currency" "wallets_currency_enum" NOT NULL,
        "balance_minor" bigint NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_wallets" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_wallets_user_currency" UNIQUE ("user_id", "currency")
      )
    `);

    // addresses
    await queryRunner.query(`
      CREATE TYPE "addresses_provider_enum" AS ENUM ('VFD')
    `);
    await queryRunner.query(`
      CREATE TYPE "addresses_status_enum" AS ENUM ('ACTIVE', 'INACTIVE')
    `);
    await queryRunner.query(`
      CREATE TABLE "addresses" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "wallet_id" uuid NOT NULL,
        "provider" "addresses_provider_enum" NOT NULL,
        "provider_account_number" character varying NOT NULL,
        "provider_account_name" character varying,
        "provider_tier_raw" character varying,
        "provider_metadata" jsonb,
        "status" "addresses_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "activated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "deactivated_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_addresses" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_addresses_provider_account_number" UNIQUE ("provider", "provider_account_number"),
        CONSTRAINT "FK_addresses_wallet" FOREIGN KEY ("wallet_id") REFERENCES "wallets" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_addresses_wallet_id" ON "addresses" ("wallet_id")`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_addresses_wallet_active" ON "addresses" ("wallet_id") WHERE "status" = 'ACTIVE'
    `);

    // wallet_transactions (append-only ledger)
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

    // provider_webhook_events (idempotency + audit authority for inbound webhooks)
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

    // Deferred FK — provider_webhook_events didn't exist yet when
    // wallet_transactions was created, so this is added last.
    await queryRunner.query(`
      ALTER TABLE "wallet_transactions"
        ADD CONSTRAINT "FK_wallet_transactions_webhook_event"
        FOREIGN KEY ("webhook_event_id") REFERENCES "provider_webhook_events" ("id") ON DELETE SET NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wallet_transactions" DROP CONSTRAINT "FK_wallet_transactions_webhook_event"`,
    );
    await queryRunner.query(`DROP TABLE "provider_webhook_events"`);
    await queryRunner.query(`DROP TYPE "provider_webhook_events_status_enum"`);
    await queryRunner.query(
      `DROP TYPE "provider_webhook_events_provider_enum"`,
    );
    await queryRunner.query(`DROP TABLE "wallet_transactions"`);
    await queryRunner.query(`DROP TYPE "wallet_transactions_source_enum"`);
    await queryRunner.query(`DROP TYPE "wallet_transactions_type_enum"`);
    await queryRunner.query(`DROP TABLE "addresses"`);
    await queryRunner.query(`DROP TYPE "addresses_status_enum"`);
    await queryRunner.query(`DROP TYPE "addresses_provider_enum"`);
    await queryRunner.query(`DROP TABLE "wallets"`);
    await queryRunner.query(`DROP TYPE "wallets_currency_enum"`);
  }
}
