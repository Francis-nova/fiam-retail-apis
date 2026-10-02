import { MigrationInterface, QueryRunner } from 'typeorm';

// Staff-approved manual wallet postings (admin console) are recorded as
// ordinary transactions with provider MANUAL, so they show up in history and
// reconciliation honestly instead of masquerading as VFD movements.
export class AddManualPostingProvider1786822000000 implements MigrationInterface {
  name = 'AddManualPostingProvider1786822000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "transactions_provider_enum" ADD VALUE IF NOT EXISTS 'MANUAL'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres can't drop a single enum value; the 'MANUAL' label stays.
  }
}
