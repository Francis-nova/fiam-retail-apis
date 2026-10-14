import { MigrationInterface, QueryRunner } from 'typeorm';

// Bill payments (airtime, data, utilities, cable TV) are ordinary DEBIT
// transactions; this column carries what was bought and, for utilities, the
// token the provider issues.
export class AddBillPayments1786823000000 implements MigrationInterface {
  name = 'AddBillPayments1786823000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "bill" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "transactions" DROP COLUMN "bill"`);
  }
}
