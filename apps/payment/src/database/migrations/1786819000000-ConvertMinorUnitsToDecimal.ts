import { MigrationInterface, QueryRunner } from 'typeorm';

// Converts every money column from bigint kobo ("_minor" naming) to
// numeric(15,4) naira decimal. Previously these held minor units (e.g.
// 100050 = ₦1000.50) specifically to dodge float-precision bugs; arithmetic
// is now done via decimal.js instead (see Wallet.balance's doc comment),
// so the extra minor-unit indirection is no longer needed and VFD's own
// API (naira-decimal both ways) no longer needs *100/÷100 conversion at
// the provider boundary. Touches wallets.balance_minor and
// transactions.amount_minor/fee_minor/balance_after_minor together since
// balance_after_minor is written directly from wallets.balance_minor at
// write time and must stay on the same unit.
export class ConvertMinorUnitsToDecimal1786819000000
  implements MigrationInterface
{
  name = 'ConvertMinorUnitsToDecimal1786819000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "wallets"
        ALTER COLUMN "balance_minor" TYPE numeric(15,4) USING (balance_minor::numeric / 100),
        ALTER COLUMN "balance_minor" SET DEFAULT 0
    `);
    await queryRunner.query(
      `ALTER TABLE "wallets" RENAME COLUMN "balance_minor" TO "balance"`,
    );

    await queryRunner.query(`
      ALTER TABLE "transactions"
        ALTER COLUMN "amount_minor" TYPE numeric(15,4) USING (amount_minor::numeric / 100)
    `);
    await queryRunner.query(
      `ALTER TABLE "transactions" RENAME COLUMN "amount_minor" TO "amount"`,
    );

    await queryRunner.query(`
      ALTER TABLE "transactions"
        ALTER COLUMN "fee_minor" TYPE numeric(15,4) USING (fee_minor::numeric / 100)
    `);
    await queryRunner.query(
      `ALTER TABLE "transactions" RENAME COLUMN "fee_minor" TO "fee"`,
    );

    await queryRunner.query(`
      ALTER TABLE "transactions"
        ALTER COLUMN "balance_after_minor" TYPE numeric(15,4) USING (balance_after_minor::numeric / 100)
    `);
    await queryRunner.query(
      `ALTER TABLE "transactions" RENAME COLUMN "balance_after_minor" TO "balance_after"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" RENAME COLUMN "balance_after" TO "balance_after_minor"`,
    );
    await queryRunner.query(`
      ALTER TABLE "transactions"
        ALTER COLUMN "balance_after_minor" TYPE bigint USING ROUND(balance_after_minor * 100)::bigint
    `);

    await queryRunner.query(
      `ALTER TABLE "transactions" RENAME COLUMN "fee" TO "fee_minor"`,
    );
    await queryRunner.query(`
      ALTER TABLE "transactions"
        ALTER COLUMN "fee_minor" TYPE bigint USING ROUND(fee_minor * 100)::bigint
    `);

    await queryRunner.query(
      `ALTER TABLE "transactions" RENAME COLUMN "amount" TO "amount_minor"`,
    );
    await queryRunner.query(`
      ALTER TABLE "transactions"
        ALTER COLUMN "amount_minor" TYPE bigint USING ROUND(amount_minor * 100)::bigint
    `);

    await queryRunner.query(
      `ALTER TABLE "wallets" RENAME COLUMN "balance" TO "balance_minor"`,
    );
    await queryRunner.query(`
      ALTER TABLE "wallets"
        ALTER COLUMN "balance_minor" TYPE bigint USING ROUND(balance_minor * 100)::bigint,
        ALTER COLUMN "balance_minor" SET DEFAULT 0
    `);
  }
}
