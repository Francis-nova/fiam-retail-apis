import * as Joi from 'joi';
import { validateEnv } from '@app/common';

interface EnvVars {
  [key: string]: unknown;
  NODE_ENV: 'development' | 'test' | 'production';
  AUTH_PORT: number;
  AUTH_DATABASE_URL: string;
  JWT_ACCESS_SECRET: string;
  JWT_ACCESS_TTL: string;
  JWT_REFRESH_SECRET: string;
  JWT_REFRESH_TTL: string;
  OTP_TTL_SECONDS: number;
  OTP_LENGTH: number;
  OTP_MAX_ATTEMPTS: number;
  OTP_RESEND_COOLDOWN_SECONDS: number;
  KYC_PROVIDER: 'qoreid';
  QOREID_CLIENT_ID: string;
  QOREID_SECRET: string;
  QOREID_BASE_URL: string;
  MINIO_ENDPOINT: string;
  MINIO_PORT: number;
  MINIO_USE_SSL: 'true' | 'false';
  MINIO_ACCESS_KEY: string;
  MINIO_SECRET_KEY: string;
  MINIO_BUCKET: string;
  RABBITMQ_URL: string;
}

export const envSchema = Joi.object<EnvVars>({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  AUTH_PORT: Joi.number().default(7001),
  AUTH_DATABASE_URL: Joi.string().uri().required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_TTL: Joi.string().default('30d'),
  OTP_TTL_SECONDS: Joi.number().default(300),
  OTP_LENGTH: Joi.number().default(6),
  OTP_MAX_ATTEMPTS: Joi.number().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: Joi.number().default(60),
  // Provider credentials are intentionally optional at boot (not .required()):
  // the rest of the auth service (register/login) must keep working in
  // dev/demo before real QoreID keys are provisioned. The provider itself
  // throws a clear error if invoked without a key configured.
  KYC_PROVIDER: Joi.string().valid('qoreid').default('qoreid'),
  QOREID_CLIENT_ID: Joi.string().allow('').default(''),
  QOREID_SECRET: Joi.string().allow('').default(''),
  QOREID_BASE_URL: Joi.string().uri().default('https://api.qoreid.com'),
  // MinIO — same "optional at boot" pattern as the SMS/KYC creds above: KYC
  // document upload is the only thing that needs these, so the rest of the
  // service keeps working before a local MinIO instance/credentials exist.
  MINIO_ENDPOINT: Joi.string().default('localhost'),
  MINIO_PORT: Joi.number().default(9000),
  MINIO_USE_SSL: Joi.string().valid('true', 'false').default('false'),
  MINIO_ACCESS_KEY: Joi.string().allow('').default(''),
  MINIO_SECRET_KEY: Joi.string().allow('').default(''),
  MINIO_BUCKET: Joi.string().default('fiam-kyc-documents'),
  // Message bus to apps/payment — publishing the account-provisioning
  // request. Default matches the local Homebrew RabbitMQ instance.
  RABBITMQ_URL: Joi.string()
    .uri({ scheme: ['amqp', 'amqps'] })
    .default('amqp://guest:guest@localhost:5672'),
});

export function validate(config: Record<string, unknown>) {
  return validateEnv(envSchema, config);
}
