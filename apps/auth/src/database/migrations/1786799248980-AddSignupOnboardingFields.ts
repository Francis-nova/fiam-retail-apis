import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSignupOnboardingFields1786799248980 implements MigrationInterface {
  name = 'AddSignupOnboardingFields1786799248980';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Backfilled with '' for pre-existing rows, then the default is dropped
    // so the app layer (RegisterDto validation) owns requiring a real value
    // for every new row going forward.
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "first_name" character varying NOT NULL DEFAULT ''
    `);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "first_name" DROP DEFAULT`,
    );
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "last_name" character varying NOT NULL DEFAULT ''
    `);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "last_name" DROP DEFAULT`,
    );

    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP WITH TIME ZONE
    `);
    // Pre-existing ACTIVE users completed email verification under the
    // old single-step flow — backfill so their onboarding progress reads
    // correctly instead of looking like a fresh, unverified signup.
    await queryRunner.query(`
      UPDATE "users" SET "email_verified_at" = "created_at" WHERE "status" = 'ACTIVE'
    `);

    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "phone_verified_at" TIMESTAMP WITH TIME ZONE
    `);

    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "bvn" character varying`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_users_bvn" ON "users" ("bvn") WHERE "bvn" IS NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN "bvn_verified_at" TIMESTAMP WITH TIME ZONE
    `);

    await queryRunner.query(
      `ALTER TYPE "otps_purpose_enum" ADD VALUE 'PHONE_VERIFICATION'`,
    );
    await queryRunner.query(
      `ALTER TYPE "otps_purpose_enum" ADD VALUE 'BVN_VERIFICATION'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres has no DROP VALUE for enums — rebuild the type without the
    // two new members instead. Any otp rows already using them would block
    // this cast, but that's the correct failure mode for a destructive
    // rollback rather than silently corrupting data.
    await queryRunner.query(
      `ALTER TYPE "otps_purpose_enum" RENAME TO "otps_purpose_enum_old"`,
    );
    await queryRunner.query(`
      CREATE TYPE "otps_purpose_enum" AS ENUM ('REGISTRATION', 'LOGIN', 'PASSWORD_RESET')
    `);
    await queryRunner.query(`
      ALTER TABLE "otps" ALTER COLUMN "purpose" TYPE "otps_purpose_enum"
      USING "purpose"::text::"otps_purpose_enum"
    `);
    await queryRunner.query(`DROP TYPE "otps_purpose_enum_old"`);

    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "bvn_verified_at"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_users_bvn"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "bvn"`);
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "phone_verified_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "email_verified_at"`,
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "last_name"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "first_name"`);
  }
}
