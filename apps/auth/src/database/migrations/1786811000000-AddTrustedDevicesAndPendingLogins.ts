import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTrustedDevicesAndPendingLogins1786811000000 implements MigrationInterface {
  name = 'AddTrustedDevicesAndPendingLogins1786811000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "trusted_devices" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "device_id" character varying NOT NULL,
        "device_name" character varying,
        "trusted_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "last_seen_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_trusted_devices" PRIMARY KEY ("id"),
        CONSTRAINT "FK_trusted_devices_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_trusted_devices_user_id" ON "trusted_devices" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_trusted_devices_user_device" ON "trusted_devices" ("user_id", "device_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "pending_logins" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "ticket_hash" character varying NOT NULL,
        "device_id" character varying,
        "device_name" character varying,
        "user_agent" character varying,
        "ip_address" character varying,
        "attempts" integer NOT NULL DEFAULT 0,
        "consumed_at" TIMESTAMP WITH TIME ZONE,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pending_logins" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pending_logins_user" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_pending_logins_user_id" ON "pending_logins" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_pending_logins_ticket_hash" ON "pending_logins" ("ticket_hash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "pending_logins"`);
    await queryRunner.query(`DROP TABLE "trusted_devices"`);
  }
}
