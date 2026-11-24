import { MigrationInterface, QueryRunner } from 'typeorm';

// Stablecoin → naira conversions get their own transaction kind.
export class AddConversionKind1790960000000 implements MigrationInterface {
  name = 'AddConversionKind1790960000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "transactions_kind_enum" ADD VALUE IF NOT EXISTS 'CONVERSION'`,
    );
  }

  // Postgres can't drop an enum value; an unused one is harmless.
  public async down(): Promise<void> {}
}
