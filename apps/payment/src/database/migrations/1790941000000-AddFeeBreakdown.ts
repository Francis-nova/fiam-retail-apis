import { MigrationInterface, QueryRunner } from 'typeorm';

// VAT on the transfer fee and stamp duty, itemised. `fee` stays the total of
// every charge, so refunds and reconciliation are unchanged.
export class AddFeeBreakdown1790941000000 implements MigrationInterface {
  name = 'AddFeeBreakdown1790941000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD "fee_vat" numeric(15,4)`,
    );
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD "stamp_duty" numeric(15,4)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "stamp_duty"`,
    );
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "fee_vat"`);
  }
}
