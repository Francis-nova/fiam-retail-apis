export interface AuthConfig {
  env: string;
  port: number;
  database: {
    url: string;
  };
  corsOrigin: string | string[];
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshSecret: string;
    refreshTtl: string;
  };
  // Outflow cap after activating on a new device (CBN circular 12 Mar 2026:
  // N20,000 for the first 24 hours; banks may set it lower, never higher).
  deviceLimit: {
    amountNgn: string;
    hours: number;
  };
  otp: {
    ttlSeconds: number;
    // Named codeLength (not length) — a plain "length" key on this nested
    // config object trips up @nestjs/config's typed-path inference, since it
    // structurally resembles an array/tuple to its Path<T> utility type.
    codeLength: number;
    maxAttempts: number;
    resendCooldownSeconds: number;
  };
  kyc: {
    provider: string;
    qoreid: {
      clientId: string;
      secret: string;
      baseUrl: string;
      livenessClientId: string;
      livenessSecret: string;
    };
  };
  internal: {
    apiKey: string;
  };
  minio: {
    endpoint: string;
    port: number;
    useSsl: boolean;
    region: string;
    autoCreateBucket: boolean;
    // Folder inside a shared bucket, e.g. "fiam-staging/". Applied by the
    // storage layer only; keys stored in the database stay prefix-free.
    keyPrefix: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
  };
  rabbitmq: {
    url: string;
  };
}

export default (): AuthConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.AUTH_PORT ?? '7001', 10),
  corsOrigin: process.env.CORS_ORIGIN?.split(',') || '*',
  database: {
    url: process.env.AUTH_DATABASE_URL as string,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET as string,
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET as string,
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  },
  deviceLimit: {
    amountNgn: process.env.NEW_DEVICE_LIMIT_NGN ?? '20000',
    hours: parseInt(process.env.NEW_DEVICE_LIMIT_HOURS ?? '24', 10),
  },
  otp: {
    ttlSeconds: parseInt(process.env.OTP_TTL_SECONDS ?? '300', 10),
    codeLength: parseInt(process.env.OTP_LENGTH ?? '6', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS ?? '5', 10),
    resendCooldownSeconds: parseInt(
      process.env.OTP_RESEND_COOLDOWN_SECONDS ?? '60',
      10,
    ),
  },
  kyc: {
    provider: process.env.KYC_PROVIDER ?? 'qoreid',
    qoreid: {
      clientId: process.env.QOREID_CLIENT_ID ?? '',
      secret: process.env.QOREID_SECRET ?? '',
      baseUrl: process.env.QOREID_BASE_URL ?? 'https://api.qoreid.com',
      // Separate QoreID project for the `liveness_nin` SDK session — product
      // entitlements are per-project. Falls back to the main pair if unset.
      livenessClientId: process.env.QOREID_LIVENESS_CLIENT_ID ?? '',
      livenessSecret: process.env.QOREID_LIVENESS_SECRET ?? '',
    },
  },
  internal: {
    apiKey: process.env.INTERNAL_API_KEY ?? '',
  },
  minio: {
    endpoint: process.env.MINIO_ENDPOINT ?? 'localhost',
    port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
    useSsl: process.env.MINIO_USE_SSL === 'true',
    // S3 region — needed by Hetzner Object Storage (fsn1 / nbg1 / hel1);
    // blank for a local MinIO.
    region: process.env.MINIO_REGION ?? '',
    // false when the bucket is created out-of-band (Hetzner): the app's
    // credentials then only need object read/write, not bucket admin.
    autoCreateBucket: process.env.MINIO_AUTO_CREATE_BUCKET !== 'false',
    keyPrefix: process.env.MINIO_KEY_PREFIX ?? '',
    accessKey: process.env.MINIO_ACCESS_KEY ?? '',
    secretKey: process.env.MINIO_SECRET_KEY ?? '',
    bucket: process.env.MINIO_BUCKET ?? 'fiam-kyc-documents',
  },
  rabbitmq: {
    url: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
  },
});
