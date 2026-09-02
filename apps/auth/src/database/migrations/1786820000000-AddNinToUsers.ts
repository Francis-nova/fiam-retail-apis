import { MigrationInterface, QueryRunner } from 'typeorm';

// NIN mirrors bvn/bvn_verified_at exactly — same "reference to an
// already-verified identity" storage rationale, see users.bvn's comment.
export class AddNinToUsers1786820000000 implements MigrationInterface {
  name = 'AddNinToUsers1786820000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "nin" character varying,
        ADD COLUMN "nin_verified_at" TIMESTAMP WITH TIME ZONE
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_users_nin" ON "users" ("nin") WHERE "nin" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_users_nin"`);
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "nin_verified_at",
        DROP COLUMN "nin"
    `);
  }
}
