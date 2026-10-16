// What the biller says about a validated customer (meter / smartcard holder).
// VFD's docs show `data: {}` for /customervalidate, but live billers can return
// the holder's details; the field names aren't documented, so look for the
// usual ones instead of assuming one.
export interface CustomerInfo {
  name: string | null;
  address: string | null;
}

const NAME_KEYS =
  /^(customer[_ ]?name|account[_ ]?name|full[_ ]?name|name|customer)$/i;
const ADDRESS_KEYS = /^(customer[_ ]?)?address$/i;

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text.length > 0 ? text : null;
}

export function extractCustomerInfo(data: unknown): CustomerInfo {
  if (!data || typeof data !== 'object') return { name: null, address: null };
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
  return { name, address };
}
