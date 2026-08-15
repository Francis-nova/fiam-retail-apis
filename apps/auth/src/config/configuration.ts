export interface AuthConfig {
  env: string;
  port: number;
  database: {
    url: string;
  };
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshSecret: string;
    refreshTtl: string;
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
  sms: {
    provider: string;
    termii: {
      apiKey: string;
      senderId: string;
      baseUrl: string;
    };
  };
  kyc: {
    provider: string;
    qoreid: {
      clientId: string;
      secret: string;
      baseUrl: string;
    };
  };
  minio: {
    endpoint: string;
    port: number;
    useSsl: boolean;
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
  database: {
    url: process.env.AUTH_DATABASE_URL as string,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET as string,
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET as string,
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
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
  sms: {
    provider: process.env.SMS_PROVIDER ?? 'termii',
    termii: {
      apiKey: process.env.TERMII_API_KEY ?? '',
      senderId: process.env.TERMII_SENDER_ID ?? '',
      baseUrl: process.env.TERMII_BASE_URL ?? 'https://api.ng.termii.com',
    },
  },
  kyc: {
    provider: process.env.KYC_PROVIDER ?? 'qoreid',
    qoreid: {
      clientId: process.env.QOREID_CLIENT_ID ?? '',
      secret: process.env.QOREID_SECRET ?? '',
      baseUrl: process.env.QOREID_BASE_URL ?? 'https://api.qoreid.com',
    },
  },
  minio: {
    endpoint: process.env.MINIO_ENDPOINT ?? 'localhost',
    port: parseInt(process.env.MINIO_PORT ?? '9000', 10),
    useSsl: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY ?? '',
    secretKey: process.env.MINIO_SECRET_KEY ?? '',
    bucket: process.env.MINIO_BUCKET ?? 'fiam-kyc-documents',
  },
  rabbitmq: {
    url: process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672',
  },
});
