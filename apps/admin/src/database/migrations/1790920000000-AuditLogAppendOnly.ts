import { MigrationInterface, QueryRunner } from 'typeorm';

// The audit log is the evidence trail for every staff action, so it must not
// be editable after the fact — not by a bug, and not by someone who gets hold
// of the app's database credentials and tries to cover their tracks.
// Triggers reject UPDATE, DELETE and TRUNCATE; only INSERT is allowed.
// (A role with ownership could still drop the trigger, which is itself a
// visible schema change — pair this with off-box backups.)
export class AuditLogAppendOnly1790920000000 implements MigrationInterface {
  name = 'AuditLogAppendOnly1790920000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'audit_logs is append-only (% not allowed)', TG_OP
          USING ERRCODE = 'insufficient_privilege';
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER audit_logs_no_update_delete
        BEFORE UPDATE OR DELETE ON "audit_logs"
        FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only()
    `);
    await queryRunner.query(`
      CREATE TRIGGER audit_logs_no_truncate
        BEFORE TRUNCATE ON "audit_logs"
        FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS audit_logs_no_truncate ON "audit_logs"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS audit_logs_no_update_delete ON "audit_logs"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS audit_logs_append_only()`);
  }
}
