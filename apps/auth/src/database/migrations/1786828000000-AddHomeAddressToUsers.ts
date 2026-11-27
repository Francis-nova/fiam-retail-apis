import { MigrationInterface, QueryRunner } from 'typeorm';

// Home address the customer enters with their proof of address.
export class AddHomeAddressToUsers1786828000000 implements MigrationInterface {
  name = 'AddHomeAddressToUsers1786828000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "home_address" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "home_address"`);
  }
}
