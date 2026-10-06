import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitAdminSchema1790873644929 implements MigrationInterface {
  name = 'InitAdminSchema1790873644929';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."staff_users_role_enum" AS ENUM('SUPER_ADMIN', 'COMPLIANCE', 'SUPPORT', 'FINANCE')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."staff_users_status_enum" AS ENUM('ACTIVE', 'DISABLED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "staff_users" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "full_name" character varying NOT NULL, "email" character varying NOT NULL, "password_hash" character varying NOT NULL, "role" "public"."staff_users_role_enum" NOT NULL, "status" "public"."staff_users_status_enum" NOT NULL DEFAULT 'ACTIVE', "must_change_password" boolean NOT NULL DEFAULT true, "failed_login_attempts" integer NOT NULL DEFAULT '0', "locked_until" TIMESTAMP WITH TIME ZONE, "last_login_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_c6b167335377df69f7910c2c75e" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_4f32dd66546226ea64f5573b77" ON "staff_users" ("email") `,
    );
    await queryRunner.query(
      `CREATE TABLE "staff_refresh_tokens" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "staff_id" uuid NOT NULL, "token_hash" character varying NOT NULL, "family_id" uuid NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "revoked_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_93a8aade9a05723e493338fa883" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a8a1ae310391e175124623e185" ON "staff_refresh_tokens" ("staff_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_08d4fd8e914a488c8a11933828" ON "staff_refresh_tokens" ("token_hash") `,
    );
    await queryRunner.query(
      `CREATE TABLE "audit_logs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "staff_id" uuid, "staff_email" character varying, "action" character varying NOT NULL, "resource_type" character varying, "resource_id" character varying, "metadata" jsonb, "ip" character varying, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6519f6b7e8f0f101a620d383ef" ON "audit_logs" ("staff_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cee5459245f652b75eb2759b4c" ON "audit_logs" ("action") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_62408b952557958fd12867cfeb" ON "audit_logs" ("resource_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2cd10fda8276bb995288acfbfb" ON "audit_logs" ("created_at") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_2cd10fda8276bb995288acfbfb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_62408b952557958fd12867cfeb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_cee5459245f652b75eb2759b4c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6519f6b7e8f0f101a620d383ef"`,
    );
    await queryRunner.query(`DROP TABLE "audit_logs"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_08d4fd8e914a488c8a11933828"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a8a1ae310391e175124623e185"`,
    );
    await queryRunner.query(`DROP TABLE "staff_refresh_tokens"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4f32dd66546226ea64f5573b77"`,
    );
    await queryRunner.query(`DROP TABLE "staff_users"`);
    await queryRunner.query(`DROP TYPE "public"."staff_users_status_enum"`);
    await queryRunner.query(`DROP TYPE "public"."staff_users_role_enum"`);
  }
}
