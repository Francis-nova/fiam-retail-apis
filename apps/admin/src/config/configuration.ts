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
  services: {
    authUrl: process.env.AUTH_INTERNAL_URL ?? 'http://localhost:7001',
    paymentUrl: process.env.PAYMENT_INTERNAL_URL ?? 'http://localhost:7003',
    internalApiKey: process.env.INTERNAL_API_KEY ?? '',
  },
});
