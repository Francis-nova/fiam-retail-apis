import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds `webhook_events` — an audit log of every inbound provider webhook,
// with `verified` / `verified_at` set once the provider's TSQ confirms it.
export class AddWebhookEvents1786820000000 implements MigrationInterface {
  name = 'AddWebhookEvents1786820000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "webhook_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "provider" character varying NOT NULL,
        "event_type" character varying NOT NULL,
        "reference" character varying,
        "payload" jsonb NOT NULL,
        "verified" boolean NOT NULL DEFAULT false,
        "verified_at" TIMESTAMP WITH TIME ZONE,
        "verification_note" text,
        "tsq_payload" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webhook_events_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_webhook_events_provider_reference" ON "webhook_events" ("provider", "reference")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "webhook_events"`);
  }
}
