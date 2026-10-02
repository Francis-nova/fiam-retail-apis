import { MigrationInterface, QueryRunner } from 'typeorm';

// Customer-initiated "delete my account" requests. Staff review them in the
// admin console; approval runs the account-closure flow.
export class AddAccountDeletionRequests1786824000000 implements MigrationInterface {
  name = 'AddAccountDeletionRequests1786824000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "account_deletion_requests_status_enum" AS ENUM ('PENDING', 'COMPLETED', 'REJECTED', 'CANCELLED')`,
    );
    await queryRunner.query(`
      CREATE TABLE "account_deletion_requests" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "reason" text,
        "status" "account_deletion_requests_status_enum" NOT NULL DEFAULT 'PENDING',
        "decided_at" TIMESTAMP WITH TIME ZONE,
        "decided_by_email" character varying,
        "decision_note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_account_deletion_requests" PRIMARY KEY ("id"),
        CONSTRAINT "FK_account_deletion_requests_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    // At most one open request per customer, enforced by the database.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_account_deletion_requests_one_pending"
        ON "account_deletion_requests" ("user_id") WHERE "status" = 'PENDING'
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_account_deletion_requests_status" ON "account_deletion_requests" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_account_deletion_requests_status"`,
    );
    await queryRunner.query(
      `DROP INDEX "IDX_account_deletion_requests_one_pending"`,
    );
    await queryRunner.query(`DROP TABLE "account_deletion_requests"`);
    await queryRunner.query(
      `DROP TYPE "account_deletion_requests_status_enum"`,
    );
  }
}
