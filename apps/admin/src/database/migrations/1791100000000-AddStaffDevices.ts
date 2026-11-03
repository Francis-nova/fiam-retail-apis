import { MigrationInterface, QueryRunner } from 'typeorm';

// Passkey-bound devices for the console's device lock. At most 3 non-revoked
// devices per staff member is enforced in DevicesService (under a row lock).
export class AddStaffDevices1791100000000 implements MigrationInterface {
  name = 'AddStaffDevices1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "staff_devices_status_enum" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED')`,
    );
    await queryRunner.query(`
      CREATE TABLE "staff_devices" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "staff_id" uuid NOT NULL,
        "label" character varying NOT NULL,
        "credential_id" character varying NOT NULL,
        "public_key" text NOT NULL,
        "counter" bigint NOT NULL DEFAULT 0,
        "transports" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "status" "staff_devices_status_enum" NOT NULL,
        "approved_by" uuid,
        "approved_at" TIMESTAMP WITH TIME ZONE,
        "last_used_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_staff_devices" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_staff_devices_staff" ON "staff_devices" ("staff_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_staff_devices_credential" ON "staff_devices" ("credential_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "staff_refresh_tokens" ADD COLUMN "device_id" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "staff_refresh_tokens" DROP COLUMN "device_id"`,
    );
    await queryRunner.query(`DROP TABLE "staff_devices"`);
    await queryRunner.query(`DROP TYPE "staff_devices_status_enum"`);
  }
}
