import { MigrationInterface, QueryRunner } from 'typeorm';

// A posting can resolve an UNMATCHED deposit: it is then linked to that
// transaction, and only one open posting per deposit is allowed so two people
// can't assign the same money to two customers.
export class PostingSourceTransaction1790930000000 implements MigrationInterface {
  name = 'PostingSourceTransaction1790930000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "postings" ADD COLUMN "source_transaction_id" uuid`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_postings_open_source_transaction"
        ON "postings" ("source_transaction_id")
        WHERE "source_transaction_id" IS NOT NULL
          AND "status" IN ('PENDING', 'PROCESSING')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_postings_open_source_transaction"`,
    );
    await queryRunner.query(
      `ALTER TABLE "postings" DROP COLUMN "source_transaction_id"`,
    );
  }
}
