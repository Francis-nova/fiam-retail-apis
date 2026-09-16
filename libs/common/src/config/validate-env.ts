import { ObjectSchema } from 'joi';

export function validateEnv<T extends Record<string, unknown>>(
  schema: ObjectSchema<T>,
  config: Record<string, unknown>,
): T {
  const result = schema.validate(config, {
    allowUnknown: true,
    abortEarly: false,
  });
  if (result.error) {
    throw new Error(`Config validation error: ${result.error.message}`);
  }
  return result.value;
}
