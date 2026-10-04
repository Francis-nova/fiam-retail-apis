export interface AdminConfig {
  env: string;
  port: number;
  corsOrigin: string | string[];
  database: {
    url: string;
    // Read-only connections into the other services' databases — the console
    // lists/searches across them directly; every *write* goes through that
    // service's own /internal API so its business rules still apply.
    authUrl: string;
    paymentUrl: string;
  };
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshTtlDays: number;
  };
  rabbitmq: {
    // Optional: staff alerts (email to super admins) are off without it.
    url: string;
  };
  totp: {
    // 32-byte hex key that encrypts staff TOTP secrets at rest.
    encryptionKey: string;
    issuer: string;
    // When true every staff member must enrol in 2FA before they can sign in.
    required: boolean;
  };
  services: {
    authUrl: string;
    paymentUrl: string;
    internalApiKey: string;
  };
}

export default (): AdminConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.ADMIN_PORT ?? '7004', 10),
  corsOrigin: process.env.CORS_ORIGIN?.split(',') || '*',
  database: {
    url: process.env.ADMIN_DATABASE_URL as string,
    authUrl: process.env.AUTH_READONLY_DATABASE_URL as string,
    paymentUrl: process.env.PAYMENT_READONLY_DATABASE_URL as string,
  },
  jwt: {
    accessSecret: process.env.ADMIN_JWT_ACCESS_SECRET as string,
    accessTtl: process.env.ADMIN_JWT_ACCESS_TTL ?? '15m',
    refreshTtlDays: parseInt(process.env.ADMIN_JWT_REFRESH_TTL_DAYS ?? '7', 10),
  },
  rabbitmq: { url: process.env.RABBITMQ_URL ?? '' },
  totp: {
    encryptionKey: process.env.ADMIN_TOTP_ENCRYPTION_KEY as string,
    issuer: process.env.ADMIN_TOTP_ISSUER ?? 'Fiam Console',
    required: process.env.ADMIN_REQUIRE_2FA === 'true',
  },
  services: {
    authUrl: process.env.AUTH_INTERNAL_URL ?? 'http://localhost:7001',
    paymentUrl: process.env.PAYMENT_INTERNAL_URL ?? 'http://localhost:7003',
    internalApiKey: process.env.INTERNAL_API_KEY ?? '',
  },
});
