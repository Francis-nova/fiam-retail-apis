const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

// QoreID's BVN response includes a `birthdate` string whose exact wire
// format hasn't been confirmed against a real sandbox response (only the
// field's presence is documented). This defensively handles the formats
// BVN-adjacent Nigerian providers commonly use and throws on anything else,
// rather than silently storing a misparsed date — VFD account creation
// depends on this being right (a wrong DOB is a hard "103 Date Of Birth
// Mismatch" from VFD, not a silent failure, but better to catch it here).
export function normalizeDobToIso(raw: string): string {
  const trimmed = raw.trim();

  // Already ISO: 'YYYY-MM-DD'
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    return trimmed;
  }

  // 'DD-Mon-YYYY' or 'DD Mon YYYY', e.g. '08-Mar-1995' / '08 Mar 1995'
  const dayMonthYearMatch = /^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s](\d{4})$/.exec(
    trimmed,
  );
  if (dayMonthYearMatch) {
    const [, day, monthName, year] = dayMonthYearMatch;
    const monthIndex = MONTHS.indexOf(monthName.slice(0, 3).toLowerCase());
    if (monthIndex !== -1) {
      return `${year}-${String(monthIndex + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }

  // 'DD/MM/YYYY'
  const slashMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slashMatch) {
    const [, day, month, year] = slashMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  throw new Error(
    `Unrecognized date-of-birth format from BVN provider: "${raw}"`,
  );
}
