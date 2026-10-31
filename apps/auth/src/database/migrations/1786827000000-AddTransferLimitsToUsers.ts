import { MigrationInterface, QueryRunner } from 'typeorm';

// Customer-chosen payout caps; null = use the tier ceiling.
export class AddTransferLimitsToUsers1786827000000 implements MigrationInterface {
  name = 'AddTransferLimitsToUsers1786827000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "transfer_limit_per_txn" numeric(18,2), ADD COLUMN "transfer_limit_daily" numeric(18,2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "transfer_limit_per_txn", DROP COLUMN "transfer_limit_daily"`,
    );
  }
}
