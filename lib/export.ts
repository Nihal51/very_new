/**
 * "Download for Excel": the admin tables as a CSV file that Excel and Google
 * Sheets open correctly — UTF-8 with a BOM (so ₹ and Hindi survive), CRLF
 * line ends, every cell quoted.
 *
 * Customer text is untrusted: a name like `=HYPERLINK(...)` would run as a
 * formula when the file is opened, so cells that start with = + - @ get a
 * leading apostrophe (the OWASP "CSV injection" guard). Phone numbers are
 * written as "91114 73929" so they need no guard and Excel does not turn them
 * into 9.11E+09.
 */

export type CsvCell = string | number | null | undefined;

export function csvCell(v: CsvCell): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(rows: CsvCell[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
}

/** "9111473929" → "91114 73929" — readable, and stays text in Excel. */
export function sheetPhone(p: string | undefined | null): string {
  const d = String(p ?? '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : String(p ?? '');
}

/** "drivebuddy-bookings-2026-10-08.csv", dated in India time. */
export function exportName(what: string, now = new Date()): string {
  return `drivebuddy-${what}-${now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}.csv`;
}

export function downloadCsv(filename: string, rows: CsvCell[][]) {
  const blob = new Blob(['﻿', toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
