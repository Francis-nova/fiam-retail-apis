import { MigrationInterface, QueryRunner } from 'typeorm';

// Staff two-factor authentication (TOTP). The secret is stored encrypted
// (AES-256-GCM, key from ADMIN_TOTP_ENCRYPTION_KEY), never in plaintext.
export class AddStaffTotp1790910000000 implements MigrationInterface {
  name = 'AddStaffTotp1790910000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "staff_users"
        ADD COLUMN "totp_secret_enc" text,
        ADD COLUMN "totp_enabled_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "totp_last_step" bigint,
        ADD COLUMN "recovery_code_hashes" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "staff_users"
        DROP COLUMN "recovery_code_hashes",
        DROP COLUMN "totp_last_step",
        DROP COLUMN "totp_enabled_at",
        DROP COLUMN "totp_secret_enc"
    `);
  }
}
