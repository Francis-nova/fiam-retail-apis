import { ObjectSchema } from 'joi';

export function validateEnv<T extends Record<string, unknown>>(
  schema: ObjectSchema<T>,
  config: Record<string, unknown>,
): T {
  const { error, value } = schema.validate(config, {
    allowUnknown: true,
    abortEarly: false,
  });
  if (error) {
    throw new Error(`Config validation error: ${error.message}`);
  }
  return value;
}
