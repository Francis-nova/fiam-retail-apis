import { ProviderBank } from '../payment-provider.interface';
import type { VfdBankListData } from './vfd.types';

// VFD's /bank response: { status: "00", data: { bank: [{ id, code, name,
// logo, created }, ...] } }. Malformed entries (missing code/name) are
// dropped rather than throwing, so a partially-odd response still yields a
// usable list.
export function normalizeVfdBankList(
  data: VfdBankListData | undefined,
): ProviderBank[] {
  const banks = data?.bank;
  if (!Array.isArray(banks)) return [];
  return banks
    .filter(
      (entry) =>
        typeof entry?.code === 'string' &&
        entry.code.length > 0 &&
        typeof entry.name === 'string' &&
        entry.name.trim().length > 0,
    )
    .map((entry) => ({ code: entry.code, name: entry.name.trim() }));
}
