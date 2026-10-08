/** The admin "Excel" download: cells Excel opens safely and correctly. */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { csvCell, exportName, sheetPhone, toCsv } from '../lib/export.ts';

test('customer text can never run as a formula in Excel', () => {
  assert.equal(csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);
  assert.equal(csvCell('+91 call'), `"'+91 call"`);
  assert.equal(csvCell('-5'), `"'-5"`);
  assert.equal(csvCell('@me'), `"'@me"`);
  assert.equal(csvCell('Ramesh'), '"Ramesh"');
});

test('rows, quotes, commas and empty cells', () => {
  assert.equal(toCsv([['a', 'b,c'], [null, 3]]), '"a","b,c"\r\n"",\"3\"');
});

test('phones stay text and readable', () => {
  assert.equal(sheetPhone('9111473929'), '91114 73929');
  assert.equal(sheetPhone('+91 91114 73929'), '91114 73929');
});

test('file name is dated in India time', () => {
  assert.equal(exportName('bookings', new Date('2026-10-08T20:00:00Z')), 'drivebuddy-bookings-2026-10-09.csv');
});
