import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sha512 } from '@app/common';
import { PaymentConfig } from '../../config/configuration';
import { PaymentProviderKey } from '../../wallets/entities/address.entity';
import {
  PaymentProvider,
  ProviderAccount,
  ProviderAccountApplicant,
  ProviderAccountDetails,
  ProviderBank,
  ProviderInitiateTransferInput,
  ProviderTransferRecipient,
  ProviderTransferRecipientInput,
  ProviderTransferResult,
} from '../payment-provider.interface';
import { formatDateForVfd } from './vfd-date.util';
import { normalizeVfdBankList } from './vfd-bank-list.util';
import {
  classifyVfdTransferResponse,
  classifyVfdTransactionStatus,
  resolveVfdOutcome,
} from './vfd-transfer-codes';
import {
  VfdAccountEnquiryResponse,
  VfdBankListResponse,
  VfdCreateAccountResponse,
  VfdRecipientResponse,
  VfdTokenResponse,
  VfdTransactionStatusResponse,
  VfdTransferResponse,
} from './vfd.types';

// VFD wallets API — https://vbaas-docs.vfdtech.ng/
// Auth is a cached token (validityTime: "-1" = never expires, per VFD's
// docs) — cached for the process lifetime, same shape as QoreIdBvnProvider's
// token cache in apps/auth, but we still track expiresAt defensively and
// clear+retry once on a rejected token.
@Injectable()
export class VfdPaymentProvider implements PaymentProvider {
  readonly key = PaymentProviderKey.VFD;

  private readonly logger = new Logger(VfdPaymentProvider.name);
  private cachedToken: { accessToken: string; expiresAt: number } | null = null;

  constructor(
    private readonly configService: ConfigService<PaymentConfig, true>,
  ) {}

  private async fetchAccessToken(): Promise<string> {
    const { authBaseUrl, consumerKey, consumerSecret } = this.configService.get(
      'vfd',
      { infer: true },
    );
    if (!consumerKey || !consumerSecret) {
      throw new ServiceUnavailableException(
        'VFD is not configured (missing VFD_CONSUMER_KEY / VFD_CONSUMER_SECRET)',
      );
    }

    const response = await fetch(`${authBaseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        consumerKey,
        consumerSecret,
        validityTime: '-1',
      }),
    });
    const body = (await response
      .json()
      .catch(() => null)) as VfdTokenResponse | null;

    if (!response.ok || body?.status !== '00' || !body.data?.access_token) {
      this.logger.error(
        `VFD token request failed: ${response.status} ${JSON.stringify(body)}`,
      );
      throw new ServiceUnavailableException('Failed to authenticate with VFD');
    }

    // expires_in from VFD is effectively infinite for validityTime "-1"
    // (docs show it as Long.MAX_VALUE); clamp so the cache TTL math never
    // overflows Date.now() + expiresIn * 1000.
    const ttlSeconds = Math.min(body.data.expires_in ?? 3600, 86_400 * 30);
    this.cachedToken = {
      accessToken: body.data.access_token,
      expiresAt: Date.now() + ttlSeconds * 1000,
    };
    return this.cachedToken.accessToken;
  }

  private async getAccessToken(): Promise<string> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 30_000) {
      return this.cachedToken.accessToken;
    }
    return this.fetchAccessToken();
  }

  // Shared by every VFD call site: attaches the cached token, retries once
  // with a fresh token on a 401 (cached token was rejected). Centralizing
  // this is what lets createAccount/listBanks/getAccountDetails/
  // lookupTransferRecipient/initiateTransfer/queryTransferStatus all avoid
  // repeating the same retry dance.
  private async authorizedFetch(
    url: string,
    init: RequestInit = {},
  ): Promise<Response> {
    let accessToken = await this.getAccessToken();
    const withToken = (token: string): RequestInit => ({
      ...init,
      headers: { ...(init.headers ?? {}), AccessToken: token },
    });
    let response = await fetch(url, withToken(accessToken));
    if (response.status === 401) {
      this.cachedToken = null;
      accessToken = await this.fetchAccessToken();
      response = await fetch(url, withToken(accessToken));
    }
    return response;
  }

  async createAccount(
    applicant: ProviderAccountApplicant,
  ): Promise<ProviderAccount> {
    const { walletBaseUrl } = this.configService.get('vfd', { infer: true });

    const params = new URLSearchParams({
      bvn: applicant.bvn,
      dateOfBirth: formatDateForVfd(applicant.dateOfBirth),
    });

    const response = await this.authorizedFetch(
      `${walletBaseUrl}/client/tiers/individual?${params.toString()}`,
      { method: 'POST' },
    );

    const body = (await response
      .json()
      .catch(() => null)) as VfdCreateAccountResponse | null;

    if (!body) {
      this.logger.error(
        `VFD account creation returned no parseable body: ${response.status}`,
      );
      throw new ServiceUnavailableException(
        'VFD account creation is currently unavailable',
      );
    }

    // "01" — Client Account Exists — is a success path, not an error: it's
    // what makes RabbitMQ redelivery idempotent even before our own DB
    // constraints kick in.
    if (body.status === '00' || body.status === '01') {
      const accountNumber = body.data?.accountNo;
      if (!accountNumber) {
        this.logger.error(
          `VFD account creation "${body.status}" had no accountNo: ${JSON.stringify(body)}`,
        );
        throw new ServiceUnavailableException(
          'VFD account creation is currently unavailable',
        );
      }
      const name = [
        body.data?.firstname,
        body.data?.middlename,
        body.data?.lastname,
      ]
        .filter(Boolean)
        .join(' ');
      return {
        provider: this.key,
        accountNumber,
        accountName: name || null,
        providerTierRaw: body.data?.currentTier ?? null,
        metadata: body.data ?? {},
      };
    }

    // Validation / applicant-data errors — the customer's BVN/DOB didn't
    // check out with VFD, this isn't a provider-availability problem.
    if (['102', '103', '106', '199', '929'].includes(body.status ?? '')) {
      this.logger.warn(
        `VFD account creation rejected: ${body.status} ${body.message}`,
      );
      throw new BadRequestException(
        body.message ?? 'VFD rejected this account creation request',
      );
    }

    // "119" (Not Authorized to Create Clients) means our own credentials/
    // permissions are misconfigured on VFD's side, not a bad customer
    // input — surface it as our own unavailability, not their fault.
    this.logger.error(
      `VFD account creation failed: ${response.status} ${JSON.stringify(body)}`,
    );
    throw new ServiceUnavailableException(
      'VFD account creation is currently unavailable',
    );
  }

  async listBanks(): Promise<ProviderBank[]> {
    const { walletBaseUrl } = this.configService.get('vfd', { infer: true });
    const response = await this.authorizedFetch(`${walletBaseUrl}/bank`);
    const body = (await response
      .json()
      .catch(() => null)) as VfdBankListResponse | null;

    if (!response.ok || !body || body.status !== '00') {
      this.logger.error(
        `VFD bank list failed: ${response.status} ${JSON.stringify(body)}`,
      );
      throw new ServiceUnavailableException(
        'Unable to fetch bank list from VFD',
      );
    }
    return normalizeVfdBankList(body.data);
  }

  // Fetches the "From" side of a transfer payload fresh, per VFD's own
  // documented golden path ("call the account enquiry API to get the From
  // details for the transfer payload") — not read from Address.
  // providerMetadata, since that's a snapshot from account-creation time and
  // this needs current accountId/clientId/balance-holder identity.
  async getAccountDetails(
    accountNumber?: string,
  ): Promise<ProviderAccountDetails> {
    const { walletBaseUrl } = this.configService.get('vfd', { infer: true });
    const qs = accountNumber
      ? `?accountNumber=${encodeURIComponent(accountNumber)}`
      : '';
    const response = await this.authorizedFetch(
      `${walletBaseUrl}/account/enquiry${qs}`,
    );
    const body = (await response
      .json()
      .catch(() => null)) as VfdAccountEnquiryResponse | null;

    if (
      !response.ok ||
      !body ||
      body.status !== '00' ||
      !body.data?.accountNo
    ) {
      this.logger.error(
        `VFD account enquiry failed: ${response.status} ${JSON.stringify(body)}`,
      );
      throw new ServiceUnavailableException(
        'Unable to fetch account details from VFD',
      );
    }
    return {
      accountNumber: body.data.accountNo,
      accountId: body.data.accountId ?? '',
      clientId: body.data.clientId ?? '',
      clientName: body.data.client ?? '',
      bvn: body.data.bvn ?? null,
    };
  }

  async lookupTransferRecipient(
    input: ProviderTransferRecipientInput,
  ): Promise<ProviderTransferRecipient> {
    const { walletBaseUrl } = this.configService.get('vfd', { infer: true });
    const params = new URLSearchParams({
      accountNo: input.accountNumber,
      bank: input.bankCode,
      transfer_type: input.transferType,
    });
    const response = await this.authorizedFetch(
      `${walletBaseUrl}/transfer/recipient?${params.toString()}`,
    );
    const body = (await response
      .json()
      .catch(() => null)) as VfdRecipientResponse | null;

    if (body?.status === '104') {
      throw new BadRequestException('Beneficiary account not found');
    }
    if (!response.ok || !body || body.status !== '00' || !body.data) {
      this.logger.error(
        `VFD recipient lookup failed: ${response.status} ${JSON.stringify(body)}`,
      );
      throw new ServiceUnavailableException(
        'Unable to resolve transfer recipient',
      );
    }
    return {
      name: body.data.name ?? null,
      clientId: body.data.clientId ?? null,
      bvn: body.data.bvn ?? null,
      accountNumber: body.data.account?.number ?? input.accountNumber,
      accountId: body.data.account?.id ?? null,
      bankName: body.data.bank ?? null,
      currency: body.data.currency ?? null,
    };
  }

  async initiateTransfer(
    input: ProviderInitiateTransferInput,
  ): Promise<ProviderTransferResult> {
    const { walletBaseUrl } = this.configService.get('vfd', { infer: true });

    // VFD's docs show amount as a plain numeric string with no stated unit
    // — same ambiguity as the inward-credit webhook (webhooks.service.ts's
    // parseAmount); assumed naira, unconfirmed against a real sandbox
    // transfer. Our own internal representation is naira decimal too now,
    // so this is a straight format, not a unit conversion.
    const amountNaira = input.amount.toFixed(2);
    const signature = sha512(
      `${input.from.accountNumber}${input.to.accountNumber}`,
    );
    // toSavingsId/toSession share the same source field (recipient-enquiry's
    // account.id) — VFD's field table just marks which one is REQUIRED per
    // transfer type, not that the other must be blank, so both are sent.
    const payload = {
      fromAccount: input.from.accountNumber,
      uniqueSenderAccountId: '',
      fromClientId: input.from.clientId,
      fromClient: input.from.clientName,
      fromSavingsId: input.from.accountId,
      fromBvn: input.from.bvn ?? '',
      toClientId: input.to.clientId ?? '',
      toClient: input.to.name ?? '',
      toSavingsId: input.to.accountId ?? '',
      toSession: input.to.accountId ?? '',
      toBvn: input.to.bvn ?? '',
      toAccount: input.to.accountNumber,
      toBank: input.bankCode,
      signature,
      amount: amountNaira,
      remark: input.narration,
      transferType: input.transferType,
      reference: input.reference,
    };

    let response: Response;
    try {
      response = await this.authorizedFetch(`${walletBaseUrl}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      // Network-level failure — we genuinely don't know if VFD received/
      // processed this. Never assume failure here; only TSQ can tell us.
      this.logger.error(
        `VFD transfer request threw for reference ${input.reference}: ${(err as Error).message}`,
      );
      return {
        outcome: 'REQUERY',
        providerReference: input.reference,
        externalId: null,
        providerStatusCode: null,
        rawPayload: null,
      };
    }

    const body = (await response
      .json()
      .catch(() => null)) as VfdTransferResponse | null;
    const classification = classifyVfdTransferResponse(body?.status);
    return {
      outcome: resolveVfdOutcome(classification),
      providerReference: body?.data?.reference ?? input.reference,
      externalId: body?.data?.sessionId ?? body?.data?.txnId ?? null,
      providerStatusCode: body?.status ?? null,
      rawPayload: (body as Record<string, unknown> | null) ?? null,
    };
  }

  async queryTransferStatus(
    reference: string,
  ): Promise<ProviderTransferResult> {
    const { walletBaseUrl } = this.configService.get('vfd', { infer: true });

    let response: Response;
    try {
      response = await this.authorizedFetch(
        `${walletBaseUrl}/transactions?reference=${encodeURIComponent(reference)}`,
      );
    } catch (err) {
      this.logger.error(
        `VFD TSQ request threw for reference ${reference}: ${(err as Error).message}`,
      );
      return {
        outcome: 'REQUERY',
        providerReference: reference,
        externalId: null,
        providerStatusCode: null,
        rawPayload: null,
      };
    }

    const body = (await response
      .json()
      .catch(() => null)) as VfdTransactionStatusResponse | null;

    if (body?.status === '108') {
      // "No Transaction!" — VFD has no record of this reference at all.
      // This code isn't part of the transactionStatus table (that table
      // describes a transaction VFD DOES know about) — treat it as a
      // confirmed, terminal failure rather than retrying forever on a
      // reference that will never resolve.
      return {
        outcome: 'FAILED',
        providerReference: reference,
        externalId: null,
        providerStatusCode: body.status,
        rawPayload: body as Record<string, unknown>,
      };
    }

    const code = body?.data?.transactionStatus ?? null;
    const classification = classifyVfdTransactionStatus(code);
    return {
      outcome: resolveVfdOutcome(classification),
      providerReference: reference,
      externalId: body?.data?.sessionId ?? body?.data?.TxnId ?? null,
      providerStatusCode: code,
      rawPayload: (body as Record<string, unknown> | null) ?? null,
    };
  }
}
