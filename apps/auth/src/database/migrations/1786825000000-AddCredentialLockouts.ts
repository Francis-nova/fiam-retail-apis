import { MigrationInterface, QueryRunner } from 'typeorm';

// Brute-force protection for the two secrets that gate an account: the
// password and the 4-digit transaction PIN. Counters live on the user so a
// lockout holds across devices, sessions and login tickets.
export class AddCredentialLockouts1786825000000 implements MigrationInterface {
  name = 'AddCredentialLockouts1786825000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "password_failed_attempts" integer NOT NULL DEFAULT 0,
        ADD COLUMN "password_locked_until" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "pin_failed_attempts" integer NOT NULL DEFAULT 0,
        ADD COLUMN "pin_locked_until" TIMESTAMP WITH TIME ZONE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "pin_locked_until",
        DROP COLUMN "pin_failed_attempts",
        DROP COLUMN "password_locked_until",
        DROP COLUMN "password_failed_attempts"
    `);
  }
}
