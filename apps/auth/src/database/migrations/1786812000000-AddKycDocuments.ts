import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKycDocuments1786812000000 implements MigrationInterface {
  name = 'AddKycDocuments1786812000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "kyc_documents_doc_type_enum" AS ENUM (
        'GOVERNMENT_ID_FRONT', 'GOVERNMENT_ID_BACK', 'NIN_SELFIE', 'PROOF_OF_ADDRESS'
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "kyc_documents" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "doc_type" "kyc_documents_doc_type_enum" NOT NULL,
        "object_key" character varying NOT NULL,
        "original_filename" character varying NOT NULL,
        "mime_type" character varying NOT NULL,
        "size_bytes" integer NOT NULL,
        "uploaded_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kyc_documents" PRIMARY KEY ("id"),
        CONSTRAINT "FK_kyc_documents_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_kyc_documents_user_id" ON "kyc_documents" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_kyc_documents_user_doc_type" ON "kyc_documents" ("user_id", "doc_type")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "kyc_documents"`);
    await queryRunner.query(`DROP TYPE "kyc_documents_doc_type_enum"`);
  }
}
