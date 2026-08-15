import * as Joi from 'joi';
import { validateEnv } from '@app/common';

export const envSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PAYMENT_PORT: Joi.number().default(7003),
  PAYMENT_DATABASE_URL: Joi.string().uri().required(),
  RABBITMQ_URL: Joi.string()
    .uri({ scheme: ['amqp', 'amqps'] })
    .default('amqp://guest:guest@localhost:5672'),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .default('redis://localhost:6379'),
  // Same secret as apps/auth's JWT_ACCESS_SECRET — required (not a
  // provider credential that's ok to be blank), since without it every
  // authenticated payment endpoint would be unreachable.
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  PAYMENT_PROVIDER_NGN: Joi.string().valid('vfd').default('vfd'),
  // VFD credentials are intentionally optional at boot, same convention as
  // Termii/QoreID in apps/auth — the provider throws a clear 503 if invoked
  // without them, rather than blocking the whole service from starting.
  VFD_AUTH_BASE_URL: Joi.string()
    .uri()
    .default(
      'https://api-devapps.vfdbank.systems/vfd-tech/baas-portal/v1.1/baasauth',
    ),
  VFD_WALLET_BASE_URL: Joi.string()
    .uri()
    .default('https://api-devapps.vfdbank.systems/vtech-wallet/api/v2/wallet2'),
  VFD_CONSUMER_KEY: Joi.string().allow('').default(''),
  VFD_CONSUMER_SECRET: Joi.string().allow('').default(''),
  VFD_WEBHOOK_SECRET: Joi.string().allow('').default(''),
  // VFD's own bank code, used to decide intra vs inter transferType.
  // Defaults to the sandbox value from VFD's "Test Accounts" docs section.
  VFD_BANK_CODE: Joi.string().default('999999'),
  // Prefixes every /transfer reference (VFD requires "wallet name" prefixed
  // references) — safe to default in dev, should be set explicitly for a
  // real registered wallet name in production.
  VFD_WALLET_NAME: Joi.string().default('FiamWallet'),
});

export function validate(config: Record<string, unknown>) {
  return validateEnv(envSchema, config);
}
