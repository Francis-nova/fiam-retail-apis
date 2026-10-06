// Minimal CSV writer for staff exports.
//
// Two safety properties matter here:
//  - quoting: commas, quotes and newlines are escaped per RFC 4180;
//  - formula injection: a cell that starts with = + - @ (or tab/CR) is run as a
//    formula by Excel/Sheets, so customer-controlled text (a narration, a
//    name) could execute on the finance person's machine. Such cells are
//    prefixed with an apostrophe, which spreadsheets show as plain text.
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (value instanceof Date) s = value.toISOString();
  else if (typeof value === 'string') s = value;
  else if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  )
    s = String(value);
  else s = JSON.stringify(value);
  // A bare negative number is data, not a formula.
  if (FORMULA_START.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  // BOM so Excel opens UTF-8 (names with accents) correctly.
  return '﻿' + lines.join('\r\n') + '\r\n';
}
