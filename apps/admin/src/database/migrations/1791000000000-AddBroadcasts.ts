import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBroadcasts1791000000000 implements MigrationInterface {
  name = 'AddBroadcasts1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "broadcasts_status_enum" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED')`,
    );
    await queryRunner.query(`
      CREATE TABLE "broadcasts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "channels" text[] NOT NULL,
        "title" character varying NOT NULL,
        "body" text NOT NULL,
        "customer_ids" uuid[],
        "status" "broadcasts_status_enum" NOT NULL DEFAULT 'QUEUED',
        "recipient_count" integer NOT NULL DEFAULT 0,
        "published_count" integer NOT NULL DEFAULT 0,
        "error" text,
        "created_by" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "completed_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_broadcasts" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "broadcasts"`);
    await queryRunner.query(`DROP TYPE "broadcasts_status_enum"`);
  }
}
