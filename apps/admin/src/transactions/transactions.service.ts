import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AUTH_DB, PAYMENT_DB } from '../database/readonly-database.module';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';

interface TxRow {
  id: string;
  wallet_id: string | null;
  user_id: string | null;
  currency: string;
  type: string;
  status: string;
  provider: string;
  account_number: string;
  amount: string;
  fee: string | null;
  balance_after: string | null;
  reference: string;
  external_id: string | null;
  provider_status_code: string | null;
  narration: string | null;
  occurred_at: Date | null;
  verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
  beneficiary_id: string | null;
  bene_name: string | null;
  bene_account_number: string | null;
  bene_bank_name: string | null;
  bene_bank_code: string | null;
  raw_payload: Record<string, unknown> | null;
}

interface CustomerRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  status: string;
  tier: string;
}

const SELECT = `
  t.id, t.wallet_id, w.user_id, t.currency, t.type, t.status, t.provider,
  t.account_number, t.amount, t.fee, t.balance_after, t.reference,
  t.external_id, t.provider_status_code, t.narration, t.occurred_at,
  t.verified_at, t.created_at, t.updated_at, t.beneficiary_id,
  b.account_name AS bene_name, b.account_number AS bene_account_number,
  b.bank_name AS bene_bank_name, b.bank_code AS bene_bank_code,
  t.raw_payload
`;
const FROM = `
  FROM transactions t
  LEFT JOIN wallets w ON w.id = t.wallet_id
  LEFT JOIN beneficiaries b ON b.id = t.beneficiary_id
`;

const str = (v: unknown) => (typeof v === 'string' ? v : null);

@Injectable()
export class TransactionsService {
  constructor(
    @InjectDataSource(PAYMENT_DB) private readonly payment: DataSource,
    @InjectDataSource(AUTH_DB) private readonly auth: DataSource,
  ) {}

  private async customers(ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, CustomerRow>();
    const rows: CustomerRow[] = await this.auth.query(
      `SELECT id, first_name, last_name, email, phone, status, tier
         FROM users WHERE id = ANY($1::uuid[])`,
      [unique],
    );
    return new Map(rows.map((r) => [r.id, r]));
  }

  private customerView(c: CustomerRow | undefined) {
    return c
      ? {
          id: c.id,
          name: `${c.first_name} ${c.last_name}`.trim(),
          email: c.email,
          phone: c.phone,
          status: c.status,
          tier: c.tier,
        }
      : null;
  }

  // Counterparty = who paid in (CREDIT, from the provider webhook) or who a
  // payout went to (DEBIT, the saved beneficiary).
  private counterparty(r: TxRow) {
    if (r.provider === 'MANUAL') {
      return {
        name: 'Manual adjustment',
        accountNumber: null,
        bankName: null,
        bankCode: null,
      };
    }
    if (r.type === 'DEBIT') {
      return {
        name: r.bene_name,
        accountNumber: r.bene_account_number,
        bankName: r.bene_bank_name,
        bankCode: r.bene_bank_code,
      };
    }
    const p = r.raw_payload;
    return {
      name: str(p?.originator_account_name),
      accountNumber: str(p?.originator_account_number),
      bankName: null,
      bankCode: str(p?.originator_bank),
    };
  }

  private listView(r: TxRow, customer: CustomerRow | undefined) {
    return {
      id: r.id,
      type: r.type,
      status: r.status,
      currency: r.currency,
      amount: r.amount,
      fee: r.fee,
      provider: r.provider,
      reference: r.reference,
      narration: r.narration,
      customer: this.customerView(customer),
      counterparty: this.counterparty(r),
      createdAt: r.created_at,
    };
  }

  // The WHERE clause shared by the list screen and the CSV export.
  private async buildFilter(q: ListTransactionsQueryDto) {
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };

    if (q.status?.length) where.push(`t.status = ANY(${add(q.status)})`);
    if (q.type) where.push(`t.type = ${add(q.type)}`);
    if (q.currency) where.push(`t.currency = ${add(q.currency.toUpperCase())}`);
    if (q.walletId) where.push(`t.wallet_id = ${add(q.walletId)}`);
    if (q.userId) where.push(`w.user_id = ${add(q.userId)}`);
    if (q.from) where.push(`t.created_at >= ${add(q.from)}`);
    if (q.to) where.push(`t.created_at <= ${add(q.to)}`);

    const term = q.q?.trim();
    if (term) {
      // Customers live in another database, so resolve matches there first.
      const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
      const users: { id: string }[] = await this.auth.query(
        `SELECT id FROM users
          WHERE email ILIKE $1 OR phone ILIKE $1
             OR (first_name || ' ' || last_name) ILIKE $1
          LIMIT 200`,
        [like],
      );
      const l = add(like);
      const direct = `t.reference ILIKE ${l} OR t.external_id ILIKE ${l}
        OR t.account_number ILIKE ${l} OR t.narration ILIKE ${l}`;
      where.push(
        users.length
          ? `(${direct} OR w.user_id = ANY(${add(users.map((u) => u.id))}::uuid[]))`
          : `(${direct})`,
      );
    }

    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    return { clause, params };
  }

  async list(q: ListTransactionsQueryDto) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const { clause, params } = await this.buildFilter(q);
    const [rows, totals, byStatus] = (await Promise.all([
      this.payment.query(
        `SELECT ${SELECT} ${FROM} ${clause}
            ORDER BY t.created_at DESC, t.id
            LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        params,
      ),
      this.payment.query(
        `SELECT count(*)::text AS total ${FROM} ${clause}`,
        params,
      ),
      // Per-status counts and money for the whole filtered set, so the page
      // can show totals that don't depend on which page you're on.
      this.payment.query(
        `SELECT t.status, t.type, count(*)::int AS count,
                  COALESCE(sum(t.amount), 0)::text AS amount
             ${FROM} ${clause} GROUP BY t.status, t.type`,
        params,
      ),
    ])) as [TxRow[], { total: string }[], unknown[]];

    const customers = await this.customers(
      rows.map((r) => r.user_id).filter((id): id is string => !!id),
    );
    return {
      items: rows.map((r) =>
        this.listView(r, r.user_id ? customers.get(r.user_id) : undefined),
      ),
      total: Number(totals[0]?.total ?? 0),
      page,
      pageSize,
      summary: byStatus,
    };
  }

  /** Every row matching the filter (capped), for the CSV export. */
  async exportRows(q: ListTransactionsQueryDto, max: number) {
    const { clause, params } = await this.buildFilter(q);
    const rows: TxRow[] = await this.payment.query(
      `SELECT ${SELECT} ${FROM} ${clause}
        ORDER BY t.created_at DESC, t.id LIMIT ${max + 1}`,
      params,
    );
    const truncated = rows.length > max;
    const page = truncated ? rows.slice(0, max) : rows;
    const customers = await this.customers(
      page.map((r) => r.user_id).filter((id): id is string => !!id),
    );
    return {
      truncated,
      items: page.map((r) =>
        this.listView(r, r.user_id ? customers.get(r.user_id) : undefined),
      ),
    };
  }

  /** The bits of a deposit needed to decide whether it can be assigned. */
  async depositForAssignment(id: string) {
    const rows: {
      id: string;
      status: string;
      type: string;
      amount: string;
      currency: string;
      wallet_id: string | null;
      reference: string;
    }[] = await this.payment.query(
      `SELECT id, status, type, amount::text, currency, wallet_id, reference
         FROM transactions WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Transaction not found');
    return rows[0];
  }

  async get(id: string) {
    const rows: TxRow[] = await this.payment.query(
      `SELECT ${SELECT} ${FROM} WHERE t.id = $1`,
      [id],
    );
    const r = rows[0];
    if (!r) throw new NotFoundException('Transaction not found');

    const customers = await this.customers(r.user_id ? [r.user_id] : []);
    const wallets: { id: string; balance: string; currency: string }[] =
      r.wallet_id
        ? await this.payment.query(
            `SELECT id, balance, currency FROM wallets WHERE id = $1`,
            [r.wallet_id],
          )
        : [];
    const addresses: {
      provider_account_number: string;
      provider_account_name: string | null;
      status: string;
    }[] = r.wallet_id
      ? await this.payment.query(
          `SELECT provider_account_number, provider_account_name, status
             FROM addresses WHERE wallet_id = $1 ORDER BY created_at DESC`,
          [r.wallet_id],
        )
      : [];

    return {
      ...this.listView(r, r.user_id ? customers.get(r.user_id) : undefined),
      sessionId: r.external_id,
      accountNumber: r.account_number,
      balanceAfter: r.balance_after,
      providerStatusCode: r.provider_status_code,
      wallet: wallets[0]
        ? {
            id: wallets[0].id,
            currency: wallets[0].currency,
            balance: wallets[0].balance,
            accounts: addresses.map((a) => ({
              accountNumber: a.provider_account_number,
              accountName: a.provider_account_name,
              status: a.status,
            })),
          }
        : null,
      occurredAt: r.occurred_at,
      verifiedAt: r.verified_at,
      updatedAt: r.updated_at,
      rawPayload: r.raw_payload,
    };
  }
}
