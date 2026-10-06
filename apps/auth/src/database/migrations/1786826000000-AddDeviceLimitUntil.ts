import { MigrationInterface, QueryRunner } from 'typeorm';

// CBN circular (12 Mar 2026, effective 1 Jul 2026): an existing customer who
// activates the app on a new device is limited to N20,000 of outflow for the
// first 24 hours. This records when that window ends; payment enforces it.
export class AddDeviceLimitUntil1786826000000 implements MigrationInterface {
  name = 'AddDeviceLimitUntil1786826000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "device_limit_until" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "device_limit_until"`,
    );
  }
}
