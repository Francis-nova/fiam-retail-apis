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
});

export function validate(config: Record<string, unknown>) {
  return validateEnv(envSchema, config);
}
