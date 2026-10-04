/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- raw query rows */
import { DataSource } from 'typeorm';
import { UnmatchedService } from './unmatched.service';
import { WalletsService } from '../wallets/wallets.service';
import { Wallet } from '../wallets/entities/wallet.entity';
import { Address } from '../wallets/entities/address.entity';
import { Transaction } from '../transactions/entities/transaction.entity';
import { Beneficiary } from '../beneficiaries/entities/beneficiary.entity';
import { WebhookEvent } from '../webhooks/entities/webhook-event.entity';

// Real-Postgres test of the money path for assigning an UNMATCHED deposit. The
// schema comes from the real payment migrations. Runs only when
// PAYMENT_TEST_DATABASE_URL points at a scratch database (it is dropped!):
//   docker run -d -p 55434:5432 -e POSTGRES_PASSWORD=x postgres:17-alpine
//   PAYMENT_TEST_DATABASE_URL=postgres://postgres:x@localhost:55434/postgres npx jest --runInBand unmatched.integration
const URL = process.env.PAYMENT_TEST_DATABASE_URL;
const d = URL ? describe : describe.skip;

d('UnmatchedService.assign (Postgres)', () => {
  let ds: DataSource;
  let svc: UnmatchedService;
  const notify = jest.fn();
  let n = 0;

  async function wallet(balance = '1000.0000') {
    n++;
    const rows = await ds.query(
      `INSERT INTO wallets (user_id, currency, balance) VALUES (gen_random_uuid(), 'NGN', $1) RETURNING id`,
      [balance],
    );
    return rows[0].id as string;
  }
  async function unmatched(amount = '7500.0000') {
    n++;
    const rows = await ds.query(
      `INSERT INTO transactions (wallet_id, currency, type, status, provider, account_number, amount, reference, raw_payload)
       VALUES (NULL, 'NGN', 'CREDIT', 'UNMATCHED', 'VFD', '9999999999', $1, $2, '{"provider":"vfd"}')
       RETURNING id`,
      [amount, `UM-${n}-${Math.random()}`],
    );
    return rows[0].id as string;
  }
  const balanceOf = async (id: string) =>
    (
      await ds.query(`SELECT balance::text AS b FROM wallets WHERE id=$1`, [id])
    )[0].b as string;
  const txnCount = async () =>
    Number(
      (await ds.query(`SELECT count(*)::int AS c FROM transactions`))[0].c,
    );
  const dto = (walletId: string) => ({
    walletId,
    reference: 'MAN-p1',
    meta: { approvedBy: 'c@fiam.ng' },
  });

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      url: URL,
      entities: [Wallet, Address, Transaction, Beneficiary, WebhookEvent],
      migrations: [__dirname + '/../database/migrations/*{.ts,.js}'],
      dropSchema: true,
    });
    await ds.initialize();
    await ds.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
    await ds.runMigrations();
    const wallets = new WalletsService(ds.getRepository(Wallet));
    svc = new UnmatchedService(ds, wallets, {
      notifyTransaction: notify,
    } as never);
  });
  afterAll(() => ds.destroy());
  beforeEach(() => notify.mockClear());

  it('credits the wallet and turns the SAME row into the credit (no second transaction row)', async () => {
    const w = await wallet('1000');
    const t = await unmatched('7500');
    const before = await txnCount();
    const res = await svc.assign(t, dto(w));
    expect(res).toMatchObject({ replayed: false, status: 'SUCCESSFUL' });
    expect(await balanceOf(w)).toBe('8500.0000');
    expect(await txnCount()).toBe(before);
    const row = (
      await ds.query(
        `SELECT wallet_id, status, balance_after::text AS ba, raw_payload FROM transactions WHERE id=$1`,
        [t],
      )
    )[0];
    expect(row).toMatchObject({
      wallet_id: w,
      status: 'SUCCESSFUL',
      ba: '8500.0000',
    });
    expect(row.raw_payload.provider).toBe('vfd'); // provider payload preserved
    expect(row.raw_payload.resolution).toMatchObject({
      reference: 'MAN-p1',
      approvedBy: 'c@fiam.ng',
    });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('is idempotent: replaying the approval credits nothing more', async () => {
    const w = await wallet('0');
    const t = await unmatched('250');
    await svc.assign(t, dto(w));
    const again = await svc.assign(t, dto(w));
    expect(again.replayed).toBe(true);
    expect(await balanceOf(w)).toBe('250.0000');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('under concurrency the money is credited exactly once', async () => {
    const w = await wallet('0');
    const t = await unmatched('1000');
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => svc.assign(t, dto(w))),
    );
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(await balanceOf(w)).toBe('1000.0000');
  });

  it('cannot be assigned to a second wallet once assigned', async () => {
    const a = await wallet('0');
    const b = await wallet('0');
    const t = await unmatched('400');
    await svc.assign(t, dto(a));
    await expect(svc.assign(t, dto(b))).rejects.toMatchObject({ status: 409 });
    expect(await balanceOf(b)).toBe('0.0000');
    expect(await balanceOf(a)).toBe('400.0000');
  });

  it('two different deposits to one wallet in parallel both land (row lock, no lost update)', async () => {
    const w = await wallet('0');
    const t1 = await unmatched('100');
    const t2 = await unmatched('200');
    await Promise.all([svc.assign(t1, dto(w)), svc.assign(t2, dto(w))]);
    expect(await balanceOf(w)).toBe('300.0000');
  });

  it('refuses things that are not unmatched deposits, touching no balance', async () => {
    const w = await wallet('50');
    const normal = (
      await ds.query(
        `INSERT INTO transactions (wallet_id, currency, type, status, provider, account_number, amount, reference)
       VALUES ($1,'NGN','CREDIT','PENDING','VFD','1','10',$2) RETURNING id`,
        [w, `N-${Math.random()}`],
      )
    )[0].id as string;
    await expect(svc.assign(normal, dto(w))).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      svc.assign('00000000-0000-4000-8000-000000000000', dto(w)),
    ).rejects.toMatchObject({ status: 404 });
    expect(await balanceOf(w)).toBe('50.0000');
  });
});
