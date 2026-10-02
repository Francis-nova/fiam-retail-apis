// Log-safety helpers. Anything that could identify a customer or unlock an
// account must never reach a log line — logs are copied to third-party
// tooling and retained far longer than the data itself should be.
export const REDACTED = '[REDACTED]';

// Matched against key names, case- and separator-insensitively
// (`account_number`, `accountNumber` and `AccountNo` all normalise the same).
const SENSITIVE_KEYS = [
  'password',
  'pin',
  'otp',
  'code',
  'token',
  'secret',
  'authorization',
  'apikey',
  'bvn',
  'nin',
  'phone',
  'email',
  'dob',
  'dateofbirth',
  'firstname',
  'lastname',
  'fullname',
  'accountname',
  'accountnumber',
  'accountno',
  'beneficiaryaccount',
  'address',
  'liveness',
  'selfie',
];

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEYS.some((s) => k === s || k.endsWith(s));
}

// Deep-copies `value`, replacing the value of any sensitive key.
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        isSensitiveKey(k) ? REDACTED : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}

// For `${...}` inside log messages: provider/response bodies.
export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(redact(value));
  } catch {
    return REDACTED;
  }
}
