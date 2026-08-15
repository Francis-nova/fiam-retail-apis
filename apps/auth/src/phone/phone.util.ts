// Accepts local (0801...), bare (801...), and international (+234801..., 234801...)
// Nigerian mobile formats and normalizes to E.164 without the "+" (234XXXXXXXXXX),
// which is the format Termii's send API expects.
export function normalizeNigerianPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');

  let local: string;
  if (digits.startsWith('234') && digits.length === 13) {
    local = digits.slice(3);
  } else if (digits.startsWith('0') && digits.length === 11) {
    local = digits.slice(1);
  } else if (digits.length === 10) {
    local = digits;
  } else {
    throw new Error('Enter a valid Nigerian phone number');
  }

  if (!/^[789]\d{9}$/.test(local)) {
    throw new Error('Enter a valid Nigerian phone number');
  }

  return `234${local}`;
}
