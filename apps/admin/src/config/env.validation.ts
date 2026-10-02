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
});

export function validate(config: Record<string, unknown>) {
  return validateEnv(envSchema, config);
}
