import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPostings1790900000000 implements MigrationInterface {
  name = 'AddPostings1790900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."postings_type_enum" AS ENUM('CREDIT', 'DEBIT')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."postings_status_enum" AS ENUM('PENDING', 'PROCESSING', 'POSTED', 'REJECTED', 'CANCELLED', 'FAILED')`,
    );
    await queryRunner.query(`
      CREATE TABLE "postings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "customer_id" uuid NOT NULL,
        "wallet_id" uuid NOT NULL,
        "currency" character varying(8) NOT NULL,
        "type" "public"."postings_type_enum" NOT NULL,
        "amount" numeric(15,4) NOT NULL,
        "reason" text NOT NULL,
        "narration" character varying(100) NOT NULL,
        "status" "public"."postings_status_enum" NOT NULL DEFAULT 'PENDING',
        "requested_by_id" uuid NOT NULL,
        "requested_by_email" character varying NOT NULL,
        "decided_by_id" uuid,
        "decided_by_email" character varying,
        "decided_at" TIMESTAMP WITH TIME ZONE,
        "decision_note" text,
        "transaction_id" uuid,
        "balance_after" numeric(15,4),
        "failure_reason" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_postings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_postings_amount_positive" CHECK ("amount" > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_postings_customer_id" ON "postings" ("customer_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_postings_status" ON "postings" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_postings_status"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_postings_customer_id"`);
    await queryRunner.query(`DROP TABLE "postings"`);
    await queryRunner.query(`DROP TYPE "public"."postings_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."postings_type_enum"`);
  }
}
