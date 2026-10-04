import { csvCell, toCsv } from './csv';

describe('csv', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('plain')).toBe('plain');
  });

  it('renders null/undefined as empty, dates as ISO, objects as JSON', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(new Date('2026-10-04T10:00:00Z'))).toBe(
      '2026-10-04T10:00:00.000Z',
    );
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });

  it.each([
    '=SUM(A1:A9)',
    '+cmd|calc',
    '@SUM(1)',
    '-2+3',
    '\t=1',
    '=HYPERLINK("http://x")',
  ])('neutralises the spreadsheet formula %j', (evil) => {
    expect(csvCell(evil).replace(/^"/, '').startsWith("'")).toBe(true);
  });

  it('leaves ordinary negative numbers alone', () => {
    expect(csvCell('-250.50')).toBe('-250.50');
    expect(csvCell(-5)).toBe('-5');
  });

  it('writes a header, CRLF rows and a BOM', () => {
    const out = toCsv(['a', 'b'], [[1, 'x,y']]);
    expect(out).toBe('﻿a,b\r\n1,"x,y"\r\n');
  });
});
