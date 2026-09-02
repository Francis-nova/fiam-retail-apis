import * as Joi from 'joi';
import { validateEnv } from '@app/common';

export const envSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  POSTOFFICE_PORT: Joi.number().default(7002),
  RABBITMQ_URL: Joi.string()
    .uri({ scheme: ['amqp', 'amqps'] })
    .default('amqp://guest:guest@localhost:5672'),
  // Provider credentials are intentionally optional at boot (not
  // .required()) — the service must keep starting before real Termii keys
  // are provisioned. TermiiSmsProvider throws a clear error if invoked
  // without them.
  SMS_PROVIDER: Joi.string().valid('termii').default('termii'),
  TERMII_API_KEY: Joi.string().allow('').default(''),
  TERMII_SENDER_ID: Joi.string().allow('').default(''),
  TERMII_BASE_URL: Joi.string().uri().default('https://api.ng.termii.com'),
  // Same "optional at boot" convention as Termii above — ZeptomailEmailProvider
  // throws a clear error if invoked without a token.
  EMAIL_PROVIDER: Joi.string().valid('zeptomail').default('zeptomail'),
  EMAIL_FROM_ADDRESS: Joi.string().email().default('noreply@usefiam.com'),
  EMAIL_FROM_NAME: Joi.string().default('Fiam'),
  // Not .uri() — ZeptoMail's own SDK expects a bare host (+ optional path),
  // e.g. "api.zeptomail.com/", and prepends the scheme itself.
  ZEPTOMAIL_TOKEN: Joi.string().allow('').default(''),
  ZEPTOMAIL_BASE_URL: Joi.string().default('api.zeptomail.com/'),
});

export function validate(config: Record<string, unknown>) {
  return validateEnv(envSchema, config);
}
