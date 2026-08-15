const MONTH_ABBREVIATIONS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

// Converts our internal 'YYYY-MM-DD' to VFD's documented 'DD-Mon-YYYY' (e.g.
// '08-Mar-1995'). A fixed month-name array, not toLocaleDateString — locale
// output isn't guaranteed stable across Node versions/environments.
export function formatDateForVfd(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) {
    throw new Error(`Expected ISO date 'YYYY-MM-DD', got "${iso}"`);
  }
  const [, year, month, day] = match;
  const monthName = MONTH_ABBREVIATIONS[parseInt(month, 10) - 1];
  if (!monthName) {
    throw new Error(`Invalid month in date "${iso}"`);
  }
  return `${day}-${monthName}-${year}`;
}
