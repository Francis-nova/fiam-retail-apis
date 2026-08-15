import { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeUserEmails1786801258598 implements MigrationInterface {
  name = 'NormalizeUserEmails1786801258598';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Pre-app-layer-fix data may contain rows that only differ by email
    // case (e.g. "user@x.com" vs "USER@X.COM") — lowercasing them in place
    // would collide against the unique index. Keep one row per
    // lower(email) group (prefer ACTIVE, then earliest created) and drop
    // the rest; their sessions/refresh_tokens/otps cascade-delete via the
    // existing FKs since they were never-completed duplicate signups.
    await queryRunner.query(`
      DELETE FROM "users" WHERE "id" IN (
        SELECT "id" FROM (
          SELECT "id",
            ROW_NUMBER() OVER (
              PARTITION BY lower("email")
              ORDER BY ("status" = 'ACTIVE') DESC, "created_at" ASC
            ) AS rn
          FROM "users"
        ) ranked
        WHERE rn > 1
      )
    `);

    await queryRunner.query(`UPDATE "users" SET "email" = lower("email")`);
  }

  public async down(): Promise<void> {
    // Not reversible — case information for deduped/lowercased rows is
    // gone. A rollback would need a pre-migration data snapshot.
  }
}
