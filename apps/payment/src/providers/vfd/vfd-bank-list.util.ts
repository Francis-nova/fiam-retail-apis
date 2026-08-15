import { ProviderBank } from '../payment-provider.interface';

// VFD's docs list the /bank endpoint but, unlike every other Transfer
// Services endpoint, don't show a sample response body — this normalizer is
// deliberately defensive about the shape until confirmed against a real
// sandbox call (same "unconfirmed" caveat as parseAmountMinor in
// webhooks.service.ts). Handles either an array of {code|bankCode, name|
// bankName} objects, or a plain {code: name} dictionary; malformed entries
// are dropped rather than throwing, so a partially-odd response still
// yields a usable (if incomplete) list.
export function normalizeVfdBankList(data: unknown): ProviderBank[] {
  if (Array.isArray(data)) {
    return data
      .map((entry): ProviderBank | null => {
        if (!entry || typeof entry !== 'object') return null;
        const record = entry as Record<string, unknown>;
        const code = record.code ?? record.bankCode ?? record.bank_code;
        const name = record.name ?? record.bankName ?? record.bank_name;
        if (typeof code !== 'string' || typeof name !== 'string') return null;
        return { code, name };
      })
      .filter((bank): bank is ProviderBank => bank !== null);
  }
  if (data && typeof data === 'object') {
    return Object.entries(data as Record<string, unknown>)
      .filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      )
      .map(([code, name]) => ({ code, name }));
  }
  return [];
}
