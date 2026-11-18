import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Decimal from 'decimal.js';
import { PaymentConfig } from '../config/configuration';

const TIMEOUT_MS = 15_000;
const RATE_TTL_MS = 60_000;

export interface StableStackWallet {
  id: string;
  address: string;
  network: string;
}

interface StableStackFeeRule {
  fee_type?: 'percentage' | 'flat';
  fee_value?: string;
}

export interface StableStackTransaction {
  transaction_id: string;
  status: string;
  crypto_transaction_id?: string | null;
  reason?: string | null;
}

// Thin client for the StableStack API (https://docs.stablestack.com). Every
// call sends the `x-api-key` header; responses are `{ status, data }`.
@Injectable()
export class StableStackClient {
  private readonly logger = new Logger(StableStackClient.name);
  // shortcut: per-process cache of the NGN rate; move to Redis if several
  // payment replicas start hammering StableStack's 60 req/min limit.
  private rate: { value: Decimal; at: number } | null = null;

  constructor(
    private readonly configService: ConfigService<PaymentConfig, true>,
  ) {}

  async createCustomer(input: {
    email: string;
    firstName: string;
    lastName: string;
  }): Promise<string> {
    const data = await this.request<{ id: string }>(
      'POST',
      '/individual-customers',
      {
        customer_type: 'individual',
        email: input.email,
        first_name: input.firstName,
        last_name: input.lastName,
      },
    );
    return data.id;
  }

  async createWallet(input: {
    customerId: string;
    currency: string;
    network: string;
  }): Promise<StableStackWallet> {
    const data = await this.request<{
      id: string;
      addresses?: { address: string; network: string }[];
    }>('POST', '/wallets', {
      customer_id: input.customerId,
      currency: input.currency,
      network: input.network,
      description: `Fiam ${input.currency} wallet`,
    });
    const address = data.addresses?.find((a) => a.network === input.network);
    if (!address) {
      this.logger.error(
        `StableStack wallet ${data.id} came back with no address`,
      );
      throw new ServiceUnavailableException(
        "We couldn't create your wallet. Please try again.",
      );
    }
    return { id: data.id, address: address.address, network: address.network };
  }

  async isValidAddress(currency: string, address: string): Promise<boolean> {
    const data = await this.request<{ valid?: boolean }>(
      'GET',
      `/payouts/validate-address?currency=${currency.toLowerCase()}&address=${encodeURIComponent(address)}`,
    );
    return data.valid === true;
  }

  // Every charge on a customer wallet withdrawal of `amount`, each deducted
  // from what reaches the recipient: StableStack's platform fee, the network
  // (gas) fee, and our merchant fee rule (null when no rule is active).
  async withdrawalFees(input: {
    customerId: string;
    currency: string;
    network: string;
    amount: Decimal;
  }): Promise<{ platform: Decimal; network: Decimal; fiam: Decimal }> {
    const data = await this.request<{
      fees?: StableStackFeeRule | StableStackFeeRule[];
      otherFee?: { fee?: string } | null;
      merchant_fee?: { amount?: string } | null;
    }>(
      'GET',
      `/payouts/fees?currency_type=STABLECOIN&amount=${input.amount.toString()}&from_currency=${input.currency.toLowerCase()}&network=${input.network}&customer_id=${input.customerId}`,
    );
    const rule = Array.isArray(data.fees) ? data.fees[0] : data.fees;
    const value = new Decimal(rule?.fee_value ?? 0);
    const platform =
      rule?.fee_type === 'percentage'
        ? input.amount
            .times(value)
            .div(100)
            .toDecimalPlaces(6, Decimal.ROUND_DOWN)
        : value;
    return {
      platform,
      network: new Decimal(data.otherFee?.fee ?? 0),
      fiam: new Decimal(data.merchant_fee?.amount ?? 0),
    };
  }

  async createWithdrawal(input: {
    customerId: string;
    currency: string;
    network: string;
    address: string;
    amount: Decimal;
    narration: string;
  }): Promise<StableStackTransaction> {
    return this.request<StableStackTransaction>('POST', '/payouts/wallets', {
      customer_id: input.customerId,
      currency: input.currency,
      network: input.network,
      address: input.address,
      amount: input.amount.toNumber(),
      narration: input.narration,
    });
  }

  async getTransaction(transactionId: string): Promise<StableStackTransaction> {
    return this.request<StableStackTransaction>(
      'GET',
      `/customers/transactions/by_txid/${encodeURIComponent(transactionId)}`,
    );
  }

  // StableStack's NGN per 1 USDC. USDT uses the same rate: both are 1:1 with USD.
  async ngnRate(): Promise<Decimal> {
    if (this.rate && Date.now() - this.rate.at < RATE_TTL_MS) {
      return this.rate.value;
    }
    const data = await this.request<{
      fees?: { market_pair?: string; exchange_rate?: string }[];
    }>(
      'GET',
      '/payouts/fees?amount=100&currency_type=FIAT&from_currency=usdc&to_currency=ngn&market_pair=usdcngn',
    );
    const raw = data.fees?.find(
      (f) => f.market_pair === 'usdcngn',
    )?.exchange_rate;
    if (!raw || !new Decimal(raw).isPositive()) {
      throw new ServiceUnavailableException('Rate is unavailable right now');
    }
    this.rate = { value: new Decimal(raw), at: Date.now() };
    return this.rate.value;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const { baseUrl, apiKey } = this.configService.get('stablestack', {
      infer: true,
    });
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Stablecoin wallets are not available yet',
      );
    }

    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          'x-api-key': apiKey,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error(
        `StableStack ${method} ${path.split('?')[0]} unreachable: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'Stablecoin service is unavailable. Please try again.',
      );
    }

    const json = (await response.json().catch(() => null)) as {
      data?: T;
      message?: string;
    } | null;
    if (response.ok && json?.data) return json.data;

    // Their message stays in our logs; customers get our own wording.
    this.logger.error(
      `StableStack ${method} ${path.split('?')[0]} failed: ${response.status} ${json?.message ?? ''}`,
    );
    if (response.status === 400 || response.status === 422) {
      throw new BadRequestException(
        "We couldn't complete that request. Please try again later.",
      );
    }
    throw new ServiceUnavailableException(
      'Stablecoin service is unavailable. Please try again.',
    );
  }
}
