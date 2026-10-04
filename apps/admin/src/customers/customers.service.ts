import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AUTH_DB, PAYMENT_DB } from '../database/readonly-database.module';
import {
  ListCustomersQueryDto,
  TierUpgradeStatus,
} from './dto/list-customers-query.dto';

interface UserRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  status: string;
  tier: string;
  tier_upgrade_status: string;
  tier_upgrade_submitted_at: Date | null;
  email_verified_at: Date | null;
  phone_verified_at: Date | null;
  bvn: string | null;
  bvn_verified_at: Date | null;
  nin: string | null;
  nin_verified_at: Date | null;
  date_of_birth: string | null;
  transaction_pin_set_at: Date | null;
  created_at: Date;
  closed_at: Date | null;
  pin_failed_attempts: number;
  pin_locked_until: Date | null;
  password_failed_attempts: number;
  password_locked_until: Date | null;
  device_limit_until: Date | null;
}

interface WalletRow {
  user_id: string;
  id: string;
  currency: string;
  balance: string;
}

// Explicit column list: password_hash and transaction_pin_hash are never read.
const COLUMNS = `
  id, first_name, last_name, email, phone, status, tier, tier_upgrade_status,
  tier_upgrade_submitted_at, email_verified_at, phone_verified_at, bvn,
  bvn_verified_at, nin, nin_verified_at,
  to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth, transaction_pin_set_at,
  created_at, closed_at, pin_failed_attempts, pin_locked_until,
  password_failed_attempts, password_locked_until, device_limit_until
`;

const lockState = (failedAttempts: number, lockedUntil: Date | null) => ({
  failedAttempts,
  lockedUntil,
  isLocked: !!lockedUntil && lockedUntil > new Date(),
});

// BVN/NIN are government identifiers — the console only ever shows the tail.
const mask = (v: string | null) =>
  v ? `${'•'.repeat(Math.max(v.length - 4, 0))}${v.slice(-4)}` : null;

// Mirrors REQUIRED_DOC_TYPES in the auth service's KYC flow (the NIN check is
// a separate, non-document requirement).
const REQUIRED_KYC_DOCS = [
  'GOVERNMENT_ID_FRONT',
  'GOVERNMENT_ID_BACK',
  'PROOF_OF_ADDRESS',
];

@Injectable()
export class CustomersService {
  constructor(
    @InjectDataSource(AUTH_DB) private readonly auth: DataSource,
    @InjectDataSource(PAYMENT_DB) private readonly payment: DataSource,
  ) {}

  private wallets(ids: string[]): Promise<WalletRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.payment.query(
      `SELECT user_id, id, currency, balance FROM wallets
        WHERE user_id = ANY($1::uuid[])`,
      [ids],
    );
  }

  private view(u: UserRow, wallets: WalletRow[]) {
    return {
      id: u.id,
      name: `${u.first_name} ${u.last_name}`.trim(),
      firstName: u.first_name,
      lastName: u.last_name,
      email: u.email,
      phone: u.phone,
      status: u.status,
      tier: u.tier,
      tierUpgradeStatus: u.tier_upgrade_status,
      tierUpgradeSubmittedAt: u.tier_upgrade_submitted_at,
      emailVerified: !!u.email_verified_at,
      phoneVerified: !!u.phone_verified_at,
      bvnVerified: !!u.bvn_verified_at,
      createdAt: u.created_at,
      closedAt: u.closed_at,
      wallets: wallets.map((w) => ({
        id: w.id,
        currency: w.currency,
        balance: w.balance,
      })),
    };
  }

  async list(q: ListCustomersQueryDto) {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 25;
    const params: unknown[] = [];
    const where: string[] = [];
    const add = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };

    if (q.status) where.push(`status = ${add(q.status)}`);
    if (q.tier) where.push(`tier = ${add(q.tier)}`);
    if (q.tierUpgradeStatus)
      where.push(`tier_upgrade_status = ${add(q.tierUpgradeStatus)}`);
    const term = q.q?.trim();
    if (term) {
      const like = add(`%${term.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(
        `(email ILIKE ${like} OR phone ILIKE ${like}
          OR (first_name || ' ' || last_name) ILIKE ${like})`,
      );
    }
    // A review queue is worked oldest-submission-first; everything else is
    // newest-customer-first.
    const order =
      q.tierUpgradeStatus === TierUpgradeStatus.UNDER_REVIEW
        ? 'tier_upgrade_submitted_at ASC NULLS LAST'
        : 'created_at DESC';
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows, total] = (await Promise.all([
      this.auth.query(
        `SELECT ${COLUMNS} FROM users ${clause}
          ORDER BY ${order}, id
          LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        params,
      ),
      this.auth.query(
        `SELECT count(*)::text AS n FROM users ${clause}`,
        params,
      ),
    ])) as [UserRow[], { n: string }[]];

    const wallets = await this.wallets(rows.map((r) => r.id));
    return {
      items: rows.map((r) =>
        this.view(
          r,
          wallets.filter((w) => w.user_id === r.id),
        ),
      ),
      total: Number(total[0]?.n ?? 0),
      page,
      pageSize,
    };
  }

  async get(id: string) {
    const rows: UserRow[] = await this.auth.query(
      `SELECT ${COLUMNS} FROM users WHERE id = $1`,
      [id],
    );
    const u = rows[0];
    if (!u) throw new NotFoundException('Customer not found');

    const [wallets, docs, txStats, sessionStats, deviceStats, deletion] =
      (await Promise.all([
        this.wallets([id]),
        this.auth.query(
          `SELECT doc_type, id_type, uploaded_at FROM kyc_documents
          WHERE user_id = $1 ORDER BY uploaded_at DESC`,
          [id],
        ),
        this.payment.query(
          `SELECT t.status, count(*)::int AS count
           FROM transactions t JOIN wallets w ON w.id = t.wallet_id
          WHERE w.user_id = $1 GROUP BY t.status`,
          [id],
        ),
        this.auth.query(
          `SELECT count(*) FILTER (WHERE revoked_at IS NULL)::int AS active,
                max(last_seen_at) AS last_seen
           FROM sessions WHERE user_id = $1`,
          [id],
        ),
        this.auth.query(
          `SELECT count(*)::int AS n FROM trusted_devices WHERE user_id = $1`,
          [id],
        ),
        this.auth.query(
          `SELECT id, reason, created_at FROM account_deletion_requests
          WHERE user_id = $1 AND status = 'PENDING'`,
          [id],
        ),
      ])) as [
        WalletRow[],
        { doc_type: string; id_type: string | null; uploaded_at: Date }[],
        { status: string; count: number }[],
        { active: number; last_seen: Date | null }[],
        { n: number }[],
        { id: string; reason: string | null; created_at: Date }[],
      ];

    return {
      ...this.view(u, wallets),
      dateOfBirth: u.date_of_birth,
      bvn: mask(u.bvn),
      nin: mask(u.nin),
      ninVerified: !!u.nin_verified_at,
      emailVerifiedAt: u.email_verified_at,
      phoneVerifiedAt: u.phone_verified_at,
      bvnVerifiedAt: u.bvn_verified_at,
      ninVerifiedAt: u.nin_verified_at,
      pinSet: !!u.transaction_pin_set_at,
      // Brute-force protection state (5 wrong tries lock for 15 minutes) and
      // the CBN new-device outflow limit — what support needs to explain "I
      // can't sign in / can't send more than ₦20,000".
      protection: {
        password: lockState(
          u.password_failed_attempts,
          u.password_locked_until,
        ),
        pin: lockState(u.pin_failed_attempts, u.pin_locked_until),
        newDeviceLimitUntil:
          u.device_limit_until && u.device_limit_until > new Date()
            ? u.device_limit_until
            : null,
      },
      kycDocuments: docs.map((d) => ({
        type: d.doc_type,
        idType: d.id_type,
        uploadedAt: d.uploaded_at,
      })),
      transactionCounts: txStats,
      activeSessions: sessionStats[0]?.active ?? 0,
      lastSeenAt: sessionStats[0]?.last_seen ?? null,
      deviceCount: deviceStats[0]?.n ?? 0,
      pendingDeletion: deletion[0]
        ? {
            id: deletion[0].id,
            reason: deletion[0].reason,
            requestedAt: deletion[0].created_at,
          }
        : null,
    };
  }

  async assertExists(id: string) {
    const rows: unknown[] = await this.auth.query(
      `SELECT 1 FROM users WHERE id = $1`,
      [id],
    );
    if (rows.length === 0) throw new NotFoundException('Customer not found');
  }

  async sessions(id: string) {
    await this.assertExists(id);
    const rows: {
      id: string;
      device_id: string | null;
      device_name: string | null;
      user_agent: string | null;
      ip_address: string | null;
      last_seen_at: Date;
      revoked_at: Date | null;
      created_at: Date;
    }[] = await this.auth.query(
      `SELECT id, device_id, device_name, user_agent, ip_address,
              last_seen_at, revoked_at, created_at
         FROM sessions WHERE user_id = $1
        ORDER BY created_at DESC LIMIT 50`,
      [id],
    );
    return rows.map((r) => ({
      id: r.id,
      deviceId: r.device_id,
      deviceName: r.device_name,
      userAgent: r.user_agent,
      ipAddress: r.ip_address,
      lastSeenAt: r.last_seen_at,
      createdAt: r.created_at,
      revokedAt: r.revoked_at,
      active: r.revoked_at === null,
    }));
  }

  async devices(id: string) {
    await this.assertExists(id);
    const rows: {
      id: string;
      device_id: string;
      device_name: string | null;
      trusted_at: Date;
      last_seen_at: Date;
      biometric_login_enabled: boolean;
      biometric_transaction_enabled: boolean;
    }[] = await this.auth.query(
      `SELECT id, device_id, device_name, trusted_at, last_seen_at,
              biometric_login_enabled, biometric_transaction_enabled
         FROM trusted_devices WHERE user_id = $1
        ORDER BY last_seen_at DESC`,
      [id],
    );
    return rows.map((r) => ({
      id: r.id,
      deviceId: r.device_id,
      deviceName: r.device_name,
      trustedAt: r.trusted_at,
      lastSeenAt: r.last_seen_at,
      biometricLogin: r.biometric_login_enabled,
      biometricTransaction: r.biometric_transaction_enabled,
    }));
  }

  // Wallets, the bank accounts that fund them, and saved payout recipients.
  async wallet(id: string) {
    await this.assertExists(id);
    const wallets = await this.wallets([id]);
    const walletIds = wallets.map((w) => w.id);
    const [accounts, beneficiaries] = (await Promise.all([
      walletIds.length
        ? this.payment.query(
            `SELECT wallet_id, provider, provider_account_number,
                    provider_account_name, status, activated_at
               FROM addresses WHERE wallet_id = ANY($1::uuid[])
              ORDER BY activated_at DESC`,
            [walletIds],
          )
        : [],
      this.payment.query(
        `SELECT id, currency, bank_name, bank_code, account_number,
                account_name, created_at
           FROM beneficiaries WHERE user_id = $1 ORDER BY created_at DESC`,
        [id],
      ),
    ])) as [
      {
        wallet_id: string;
        provider: string;
        provider_account_number: string;
        provider_account_name: string | null;
        status: string;
        activated_at: Date;
      }[],
      {
        id: string;
        currency: string;
        bank_name: string | null;
        bank_code: string;
        account_number: string;
        account_name: string | null;
        created_at: Date;
      }[],
    ];
    return {
      wallets: wallets.map((w) => ({
        id: w.id,
        currency: w.currency,
        balance: w.balance,
        accounts: accounts
          .filter((a) => a.wallet_id === w.id)
          .map((a) => ({
            provider: a.provider,
            accountNumber: a.provider_account_number,
            accountName: a.provider_account_name,
            status: a.status,
            activatedAt: a.activated_at,
          })),
      })),
      beneficiaries: beneficiaries.map((b) => ({
        id: b.id,
        currency: b.currency,
        bankName: b.bank_name,
        bankCode: b.bank_code,
        accountNumber: b.account_number,
        accountName: b.account_name,
        createdAt: b.created_at,
      })),
    };
  }

  // Everything the close-account precheck needs: money still in the wallet,
  // or payments still in flight, both block closure.
  async closureBlockers(id: string) {
    const [bal, inflight] = (await Promise.all([
      this.payment.query(
        `SELECT COALESCE(sum(balance), 0)::text AS total
             FROM wallets WHERE user_id = $1`,
        [id],
      ),
      this.payment.query(
        `SELECT count(*)::int AS n
             FROM transactions t JOIN wallets w ON w.id = t.wallet_id
            WHERE w.user_id = $1 AND t.status IN ('PENDING', 'PROCESSING')`,
        [id],
      ),
    ])) as [{ total: string }[], { n: number }[]];
    return {
      balance: bal[0]?.total ?? '0',
      inFlight: inflight[0]?.n ?? 0,
    };
  }

  // Raw row for the action service (status, original contact details).
  async snapshot(id: string) {
    const rows: UserRow[] = await this.auth.query(
      `SELECT ${COLUMNS} FROM users WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Customer not found');
    return rows[0];
  }

  // Name/email lookup for screens that list things belonging to customers.
  async contacts(ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length === 0)
      return new Map<string, { name: string; email: string }>();
    const rows: {
      id: string;
      first_name: string;
      last_name: string;
      email: string;
    }[] = await this.auth.query(
      `SELECT id, first_name, last_name, email FROM users WHERE id = ANY($1::uuid[])`,
      [unique],
    );
    return new Map(
      rows.map((r) => [
        r.id,
        { name: `${r.first_name} ${r.last_name}`.trim(), email: r.email },
      ]),
    );
  }

  // The customer's wallet in a currency, with its live balance.
  async walletFor(userId: string, currency: string) {
    const rows: { id: string; currency: string; balance: string }[] =
      await this.payment.query(
        `SELECT id, currency, balance FROM wallets
          WHERE user_id = $1 AND currency = $2`,
        [userId, currency],
      );
    return rows[0] ?? null;
  }

  // Everything a reviewer needs on one screen: where the upgrade stands,
  // the automated checks, and the uploaded documents (files themselves are
  // fetched separately, one at a time, so each view is audited).
  async kyc(id: string) {
    const u = await this.snapshot(id);
    const [extra, docs] = (await Promise.all([
      this.auth.query(
        `SELECT tier_upgrade_decided_at, tier_upgrade_decision_note
           FROM users WHERE id = $1`,
        [id],
      ),
      this.auth.query(
        `SELECT id, doc_type, id_type, original_filename, mime_type,
                size_bytes, uploaded_at, ocr_text
           FROM kyc_documents WHERE user_id = $1 ORDER BY doc_type`,
        [id],
      ),
    ])) as [
      {
        tier_upgrade_decided_at: Date | null;
        tier_upgrade_decision_note: string | null;
      }[],
      {
        id: string;
        doc_type: string;
        id_type: string | null;
        original_filename: string;
        mime_type: string;
        size_bytes: number;
        uploaded_at: Date;
        ocr_text: string | null;
      }[],
    ];
    const have = new Set(docs.map((d) => d.doc_type));
    return {
      accountStatus: u.status,
      tier: u.tier,
      status: u.tier_upgrade_status,
      submittedAt: u.tier_upgrade_submitted_at,
      decidedAt: extra[0]?.tier_upgrade_decided_at ?? null,
      decisionNote: extra[0]?.tier_upgrade_decision_note ?? null,
      checks: {
        accountActive: u.status === 'ACTIVE',
        bvnVerified: !!u.bvn_verified_at,
        ninVerified: !!u.nin_verified_at,
        documentsComplete: REQUIRED_KYC_DOCS.every((t) => have.has(t)),
      },
      requiredDocTypes: REQUIRED_KYC_DOCS,
      documents: docs.map((d) => ({
        id: d.id,
        docType: d.doc_type,
        idType: d.id_type,
        filename: d.original_filename,
        mimeType: d.mime_type,
        sizeBytes: d.size_bytes,
        uploadedAt: d.uploaded_at,
        ocrText: d.ocr_text,
      })),
    };
  }

  async documentMeta(userId: string, docId: string) {
    const rows: {
      doc_type: string;
      mime_type: string;
      original_filename: string;
    }[] = await this.auth.query(
      `SELECT doc_type, mime_type, original_filename
           FROM kyc_documents WHERE id = $1 AND user_id = $2`,
      [docId, userId],
    );
    if (!rows[0]) throw new NotFoundException('Document not found');
    return rows[0];
  }
}
