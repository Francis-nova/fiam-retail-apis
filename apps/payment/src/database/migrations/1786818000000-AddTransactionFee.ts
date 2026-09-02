import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds `fee_minor` to `transactions` — the transfer fee actually charged for
// a DEBIT (payout), on top of the amount sent to the recipient. Null for
// CREDIT rows and for any DEBIT predating this column (fee wasn't tracked
// before). See payouts/fee.util.ts for how it's calculated.
export class AddTransactionFee1786818000000 implements MigrationInterface {
  name = 'AddTransactionFee1786818000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "transactions" ADD COLUMN "fee_minor" bigint
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" DROP COLUMN "fee_minor"`,
    );
  }
}
