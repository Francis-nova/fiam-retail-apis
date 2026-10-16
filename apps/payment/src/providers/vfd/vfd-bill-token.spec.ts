import { extractBillTokens, formatTokenForDisplay } from './vfd-bill-token';

describe('extractBillTokens', () => {
  it('returns nothing for the empty fields of a payment with no token', () => {
    expect(
      extractBillTokens({
        kct1: '',
        kct2: '',
        token: '',
        creditToken: '',
        reference: 'R',
      }),
    ).toEqual({ token: null, extras: [] });
    expect(extractBillTokens(undefined)).toEqual({ token: null, extras: [] });
  });

  it('reads token, falling back to creditToken then other names', () => {
    expect(extractBillTokens({ token: '1234' }).token).toBe('1234');
    expect(extractBillTokens({ token: '', creditToken: '5678' }).token).toBe(
      '5678',
    );
    expect(extractBillTokens({ energyToken: 'E1' }).token).toBe('E1');
    expect(extractBillTokens({ pin: 'P1' }).token).toBe('P1');
  });

  it('prefers token over creditToken when both are set', () => {
    expect(extractBillTokens({ token: 'A', creditToken: 'B' }).token).toBe('A');
  });

  it('collects the AEDC key change tokens in order', () => {
    expect(
      extractBillTokens({
        kct1: '11111111',
        kct2: '22222222',
        token: '33333333',
      }),
    ).toEqual({
      token: '33333333',
      extras: [
        { label: 'Key change token 1', value: '11111111' },
        { label: 'Key change token 2', value: '22222222' },
      ],
    });
  });

  it('accepts numeric values and trims whitespace', () => {
    expect(extractBillTokens({ token: ' 123456789012 ' }).token).toBe(
      '123456789012',
    );
    expect(extractBillTokens({ token: 123456789012 }).token).toBe(
      '123456789012',
    );
  });
});

describe('formatTokenForDisplay', () => {
  it('groups a long numeric token in fours', () => {
    expect(formatTokenForDisplay('12345678901234567890')).toBe(
      '1234 5678 9012 3456 7890',
    );
    expect(formatTokenForDisplay('1234 5678 9012 3456 7890')).toBe(
      '1234 5678 9012 3456 7890',
    );
  });
  it('leaves short or non-numeric codes as they are', () => {
    expect(formatTokenForDisplay('ABC-123')).toBe('ABC-123');
    expect(formatTokenForDisplay('123456')).toBe('123456');
  });
});
