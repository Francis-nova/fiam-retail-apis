import * as Joi from 'joi';
import { validateEnv } from '@app/common';

interface EnvVars {
  [key: string]: unknown;
  NODE_ENV: 'development' | 'test' | 'production';
  ADMIN_PORT: number;
  ADMIN_DATABASE_URL: string;
  AUTH_READONLY_DATABASE_URL: string;
  PAYMENT_READONLY_DATABASE_URL: string;
  ADMIN_JWT_ACCESS_SECRET: string;
  ADMIN_JWT_ACCESS_TTL: string;
  ADMIN_JWT_REFRESH_TTL_DAYS: number;
  AUTH_INTERNAL_URL: string;
  PAYMENT_INTERNAL_URL: string;
  INTERNAL_API_KEY: string;
  ADMIN_TOTP_ENCRYPTION_KEY: string;
  ADMIN_TOTP_ISSUER: string;
  ADMIN_REQUIRE_2FA: 'true' | 'false';
}

export const envSchema = Joi.object<EnvVars>({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  ADMIN_PORT: Joi.number().default(7004),
  ADMIN_DATABASE_URL: Joi.string().uri().required(),
  AUTH_READONLY_DATABASE_URL: Joi.string().uri().required(),
  PAYMENT_READONLY_DATABASE_URL: Joi.string().uri().required(),
  // Deliberately a different secret from the customer-facing JWT_ACCESS_SECRET:
  // a staff token must never validate against the customer APIs (or vice versa).
  ADMIN_JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  ADMIN_JWT_ACCESS_TTL: Joi.string().default('15m'),
  ADMIN_JWT_REFRESH_TTL_DAYS: Joi.number().default(7),
  AUTH_INTERNAL_URL: Joi.string().uri().default('http://localhost:7001'),
  PAYMENT_INTERNAL_URL: Joi.string().uri().default('http://localhost:7003'),
  INTERNAL_API_KEY: Joi.string().min(32).allow('').default(''),
  // Encrypts staff TOTP secrets at rest: `openssl rand -hex 32`. Losing or
  // rotating it makes every enrolled authenticator unreadable (re-enrol).
  ADMIN_TOTP_ENCRYPTION_KEY: Joi.string()
    .pattern(/^[0-9a-fA-F]{64}$/)
    .required(),
  ADMIN_TOTP_ISSUER: Joi.string().default('Fiam Console'),
  ADMIN_REQUIRE_2FA: Joi.string().valid('true', 'false').default('false'),
});

export function validate(config: Record<string, unknown>) {
  return validateEnv(envSchema, config);
}
