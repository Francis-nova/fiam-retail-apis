import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds the declared government-ID type (customer-selected before upload) and
// a slot for the OCR text extracted from that document — both nullable since
// they only apply to GOVERNMENT_ID_FRONT/BACK rows, not NIN_SELFIE or
// PROOF_OF_ADDRESS.
export class AddKycIdTypeAndOcr1786819000000 implements MigrationInterface {
  name = 'AddKycIdTypeAndOcr1786819000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "kyc_documents_id_type_enum" AS ENUM (
        'NATIONAL_ID', 'DRIVERS_LICENSE', 'VOTERS_CARD', 'INTERNATIONAL_PASSPORT'
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "kyc_documents"
        ADD COLUMN "id_type" "kyc_documents_id_type_enum",
        ADD COLUMN "ocr_text" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kyc_documents"
        DROP COLUMN "ocr_text",
        DROP COLUMN "id_type"
    `);
    await queryRunner.query(`DROP TYPE "kyc_documents_id_type_enum"`);
  }
}
