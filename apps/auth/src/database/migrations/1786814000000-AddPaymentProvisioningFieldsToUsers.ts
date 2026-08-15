import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentProvisioningFieldsToUsers1786814000000 implements MigrationInterface {
  name = 'AddPaymentProvisioningFieldsToUsers1786814000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "date_of_birth" date,
        ADD COLUMN "payment_account_provisioning_requested_at" TIMESTAMP WITH TIME ZONE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "payment_account_provisioning_requested_at",
        DROP COLUMN "date_of_birth"
    `);
  }
}
