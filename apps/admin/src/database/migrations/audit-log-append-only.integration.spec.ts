import { DataSource } from 'typeorm';
import { AuditLogAppendOnly1790920000000 } from './1790920000000-AuditLogAppendOnly';

// Needs a scratch Postgres (see auth.integration.spec.ts); skipped otherwise.
const URL = process.env.ADMIN_TEST_DATABASE_URL;
const d = URL ? describe : describe.skip;

d('audit_logs append-only trigger (Postgres)', () => {
  let ds: DataSource;
  beforeAll(async () => {
    ds = new DataSource({ type: 'postgres', url: URL, dropSchema: true });
    await ds.initialize();
    await ds.query(
      `CREATE TABLE audit_logs (id serial PRIMARY KEY, action text NOT NULL)`,
    );
    const qr = ds.createQueryRunner();
    await new AuditLogAppendOnly1790920000000().up(qr);
    await qr.release();
    await ds.query(`INSERT INTO audit_logs (action) VALUES ('seed')`);
  });
  afterAll(() => ds.destroy());

  it('still allows inserts', async () => {
    await ds.query(`INSERT INTO audit_logs (action) VALUES ('later')`);
    const rows: unknown[] = await ds.query(`SELECT * FROM audit_logs`);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    ['UPDATE', `UPDATE audit_logs SET action = 'tampered'`],
    ['DELETE', `DELETE FROM audit_logs`],
    ['TRUNCATE', `TRUNCATE audit_logs`],
  ])('rejects %s', async (_op, sql) => {
    await expect(ds.query(sql)).rejects.toThrow(/append-only/);
  });

  it('really left the rows intact', async () => {
    const rows: { action: string }[] = await ds.query(
      `SELECT action FROM audit_logs ORDER BY id`,
    );
    expect(rows[0].action).toBe('seed');
  });
});
