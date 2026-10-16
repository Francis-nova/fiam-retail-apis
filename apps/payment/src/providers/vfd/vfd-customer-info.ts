// What the biller says about a validated customer (meter / smartcard holder).
// VFD's docs show `data: {}` for /customervalidate, but live billers can return
// the holder's details; the field names aren't documented, so look for the
// usual ones instead of assuming one.
export interface CustomerInfo {
  name: string | null;
  address: string | null;
  // Every readable field the biller returned, labelled for display.
  details: { label: string; value: string }[];
}

const NAME_KEYS =
  /^(customer[_ ]?name|account[_ ]?name|full[_ ]?name|name|customer)$/i;
const ADDRESS_KEYS = /^(customer[_ ]?)?address$/i;

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length > 0 ? text : null;
}

function labelFor(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Scalar, non-empty, human-sized fields only; ids/tokens that aren't useful to
// the customer are still harmless to show, so no field-name guessing here.
function extractDetails(
  record: Record<string, unknown>,
): { label: string; value: string }[] {
  const details: { label: string; value: string }[] = [];
  for (const [key, raw] of Object.entries(record)) {
    const value = typeof raw === 'number' ? String(raw) : clean(raw);
    if (!value || value.length > 120) continue;
    details.push({ label: labelFor(key), value });
    if (details.length >= 12) break;
  }
  return details;
}

export function extractCustomerInfo(data: unknown): CustomerInfo {
  if (!data || typeof data !== 'object') {
    return { name: null, address: null, details: [] };
  }
  const record = data as Record<string, unknown>;
  let name: string | null = null;
  let address: string | null = null;
  for (const [key, value] of Object.entries(record)) {
    if (!name && NAME_KEYS.test(key)) name = clean(value);
    if (!address && ADDRESS_KEYS.test(key)) address = clean(value);
  }
  if (!name) {
    const first = clean(record.firstName ?? record.firstname);
    const last = clean(record.lastName ?? record.lastname);
    name = [first, last].filter(Boolean).join(' ') || null;
  }
  return { name, address, details: extractDetails(record) };
}
