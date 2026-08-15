import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTierAndPinToUsers1786810000000 implements MigrationInterface {
  name = 'AddTierAndPinToUsers1786810000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "users_tier_enum" AS ENUM ('TIER_1', 'TIER_2', 'TIER_3')
    `);
    await queryRunner.query(`
      CREATE TYPE "users_tier_upgrade_status_enum" AS ENUM ('NONE', 'UNDER_REVIEW', 'APPROVED', 'REJECTED')
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "tier" "users_tier_enum" NOT NULL DEFAULT 'TIER_1',
        ADD COLUMN "transaction_pin_hash" character varying,
        ADD COLUMN "transaction_pin_set_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "tier_upgrade_status" "users_tier_upgrade_status_enum" NOT NULL DEFAULT 'NONE',
        ADD COLUMN "tier_upgrade_submitted_at" TIMESTAMP WITH TIME ZONE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "tier_upgrade_submitted_at",
        DROP COLUMN "tier_upgrade_status",
        DROP COLUMN "transaction_pin_set_at",
        DROP COLUMN "transaction_pin_hash",
        DROP COLUMN "tier"
    `);
    await queryRunner.query(`DROP TYPE "users_tier_upgrade_status_enum"`);
    await queryRunner.query(`DROP TYPE "users_tier_enum"`);
  }
}
