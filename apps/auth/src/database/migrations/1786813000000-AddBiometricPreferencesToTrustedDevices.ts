import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBiometricPreferencesToTrustedDevices1786813000000 implements MigrationInterface {
  name = 'AddBiometricPreferencesToTrustedDevices1786813000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trusted_devices"
        ADD COLUMN "biometric_login_enabled" boolean NOT NULL DEFAULT false,
        ADD COLUMN "biometric_transaction_enabled" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "trusted_devices"
        DROP COLUMN "biometric_transaction_enabled",
        DROP COLUMN "biometric_login_enabled"
    `);
  }
}
