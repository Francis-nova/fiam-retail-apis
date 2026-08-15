import { CurrencyCode } from '@app/common';

export interface PaymentConfig {
  env: string;
  port: number;
  database: {
    url: string;
  };
  rabbitmq: {
    url: string;
  };
  redis: {
    url: string;
  };
  // Shared with apps/auth so this service can independently verify JWTs
  // issued at login (signature + expiry only — no session-revocation
  // lookup, since payment has no sessions table; see JwtAuthGuard's doc
  // comment for the trade-off).
  jwt: {
    accessSecret: string;
  };
  payments: {
    // Raw config strings (e.g. 'vfd'), same lowercase convention as
    // SMS_PROVIDER/KYC_PROVIDER — mapped to PaymentProviderKey by
    // PaymentProviderRegistryService, not here.
    providerByCurrency: Record<CurrencyCode, string>;
  };
  vfd: {
    authBaseUrl: string;
    walletBaseUrl: string;
    consumerKey: string;
    consumerSecret: string;
    webhookSecret: string;
    // VFD's own bank code — a toBank equal to this means an intra (VFD to
    // VFD) transfer rather than inter (VFD to another bank). Defaults to
    // the sandbox's own test value (see "5. Test Accounts" in VFD's docs).
    bankCode: string;
    // Prefixes every /transfer reference we generate — VFD requires
    // references to be "prefixed with wallet name e.g
    // TestWallet-AWW3WDIUWU4U".
    walletName: string;
  };
}

export default (): PaymentConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PAYMENT_PORT ?? '7003', 10),
  database: {
    url: process.env.PAYMENT_DATABASE_URL as string,
  },
  rabbitmq: {
    url: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET as string,
  },
  payments: {
    // Extensible: PAYMENT_PROVIDER_USD, PAYMENT_PROVIDER_GBP, etc. join this
    // map when those currencies launch — one env var + one entry.
    providerByCurrency: {
      [CurrencyCode.NGN]: process.env.PAYMENT_PROVIDER_NGN ?? 'vfd',
    },
  },
  vfd: {
    authBaseUrl:
      process.env.VFD_AUTH_BASE_URL ??
      'https://api-devapps.vfdbank.systems/vfd-tech/baas-portal/v1.1/baasauth',
    walletBaseUrl:
      process.env.VFD_WALLET_BASE_URL ??
      'https://api-devapps.vfdbank.systems/vtech-wallet/api/v2/wallet2',
    consumerKey: process.env.VFD_CONSUMER_KEY ?? '',
    consumerSecret: process.env.VFD_CONSUMER_SECRET ?? '',
    webhookSecret: process.env.VFD_WEBHOOK_SECRET ?? '',
    bankCode: process.env.VFD_BANK_CODE ?? '999999',
    walletName: process.env.VFD_WALLET_NAME ?? 'FiamWallet',
  },
});
