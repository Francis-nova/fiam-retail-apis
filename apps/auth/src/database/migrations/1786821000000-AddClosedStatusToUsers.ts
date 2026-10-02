import { MigrationInterface, QueryRunner } from 'typeorm';

// Account closure (console "close account"): a terminal status distinct from
// SUSPENDED, so a closed customer can never be reactivated or resume signup.
export class AddClosedStatusToUsers1786821000000 implements MigrationInterface {
  name = 'AddClosedStatusToUsers1786821000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "users_status_enum" ADD VALUE IF NOT EXISTS 'CLOSED'`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "closed_at" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres can't drop a single enum value; the 'CLOSED' label stays.
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "closed_at"`);
  }
}
