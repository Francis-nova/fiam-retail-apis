import { MigrationInterface, QueryRunner } from 'typeorm';

// Records the outcome of a tier-upgrade review so a rejected customer can be
// told why (and the decision time is on the row, not only in the console's
// audit log).
export class AddTierUpgradeDecision1786823000000 implements MigrationInterface {
  name = 'AddTierUpgradeDecision1786823000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "tier_upgrade_decided_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "tier_upgrade_decision_note" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "tier_upgrade_decision_note",
        DROP COLUMN "tier_upgrade_decided_at"
    `);
  }
}
