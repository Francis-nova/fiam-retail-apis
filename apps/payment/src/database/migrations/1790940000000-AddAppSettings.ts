import { MigrationInterface, QueryRunner } from 'typeorm';

// Runtime key/value switches staff can flip from the admin console without a
// redeploy. First use: the "2 free payouts a day" rule.
export class AddAppSettings1790940000000 implements MigrationInterface {
  name = 'AddAppSettings1790940000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "app_settings" (
        "key" character varying NOT NULL,
        "value" jsonb NOT NULL,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_app_settings_key" PRIMARY KEY ("key")
      )
    `);
    await queryRunner.query(
      `INSERT INTO "app_settings" ("key","value") VALUES ('free_payouts_enabled','true')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "app_settings"`);
  }
}
