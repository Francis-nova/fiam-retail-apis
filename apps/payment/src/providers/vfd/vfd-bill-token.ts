// What a biller hands back to be keyed in or entered somewhere: an electricity
// token, a voucher PIN, and for some DisCos (AEDC first-time purchases) two key
// change tokens that must be entered before the energy token. VFD's docs only
// name `token` and show `kct1`/`kct2`/`creditToken` in the response shape, so
// every known field is read and the first filled one is the main token.
export interface BillTokenExtra {
  label: string;
  value: string;
}

export interface BillTokens {
  token: string | null;
  // Extra codes to enter, in order, before the main token.
  extras: BillTokenExtra[];
}

const MAIN_KEYS = ['token', 'creditToken', 'energyToken', 'pin'] as const;
const EXTRA_KEYS: [string, string][] = [
  ['kct1', 'Key change token 1'],
  ['kct2', 'Key change token 2'],
];

function text(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const cleaned = String(value).trim();
  return cleaned.length > 0 ? cleaned : null;
}

export function extractBillTokens(data: unknown): BillTokens {
  if (!data || typeof data !== 'object') return { token: null, extras: [] };
  const record = data as Record<string, unknown>;
  let token: string | null = null;
  for (const key of MAIN_KEYS) {
    token = text(record[key]);
    if (token) break;
  }
  const extras: BillTokenExtra[] = [];
  for (const [key, label] of EXTRA_KEYS) {
    const value = text(record[key]);
    if (value) extras.push({ label, value });
  }
  return { token, extras };
}

// Electricity tokens are 20 digits; shown in groups of four so they can be read
// and keyed in without losing your place. Anything else is left as sent.
export function formatTokenForDisplay(token: string): string {
  const digits = token.replace(/\s+/g, '');
  return /^\d{12,}$/.test(digits)
    ? (digits.match(/.{1,4}/g) ?? [digits]).join(' ')
    : token;
}

// Receipt lines a DisCo sometimes returns next to the token (units bought,
// tariff, VAT, the DisCo's own receipt number). VFD's docs don't list them, so
// match on a normalised key (case, `_` and `-` ignored) and take whatever is
// there; labels are what the customer sees, in the order they are shown.
const DETAIL_KEYS: [string, string[]][] = [
  ['Receipt no', ['receiptno', 'receiptnumber', 'receiptid', 'rctnum']],
  [
    'Units',
    ['units', 'unit', 'unitsvalue', 'unitspurchased', 'totalunit', 'kwh'],
  ],
  ['Tariff class', ['tariffclass', 'tariffname', 'tariffindex', 'tariff']],
  ['Tariff rate', ['tariffrate', 'rate']],
  ['VAT amount', ['vatamount', 'vat', 'tax', 'taxamount']],
  ['VAT rate', ['vatrate', 'taxrate']],
];

export interface BillDetail {
  label: string;
  value: string;
}

export function extractBillDetails(data: unknown): BillDetail[] {
  if (!data || typeof data !== 'object') return [];
  const normalised = new Map<string, unknown>();
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    normalised.set(key.toLowerCase().replace(/[^a-z0-9]/g, ''), value);
  }
  const details: BillDetail[] = [];
  for (const [label, keys] of DETAIL_KEYS) {
    for (const key of keys) {
      const value = text(normalised.get(key));
      if (value) {
        details.push({ label, value });
        break;
      }
    }
  }
  return details;
}
