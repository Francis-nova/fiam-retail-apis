import { extractCustomerInfo } from './vfd-customer-info';

describe('extractCustomerInfo', () => {
  it('returns nothing for the empty object VFD documents', () => {
    expect(extractCustomerInfo({})).toEqual({ name: null, address: null });
    expect(extractCustomerInfo(undefined)).toEqual({
      name: null,
      address: null,
    });
    expect(extractCustomerInfo('x')).toEqual({ name: null, address: null });
  });

  it('finds the usual name and address fields', () => {
    expect(
      extractCustomerInfo({
        customerName: ' ADA  OKAFOR ',
        address: '1 Allen Ave',
      }),
    ).toEqual({ name: 'ADA OKAFOR', address: '1 Allen Ave' });
    expect(extractCustomerInfo({ name: 'Ada', Address: 'Lagos' })).toEqual({
      name: 'Ada',
      address: 'Lagos',
    });
  });

  it('joins first and last name when there is no single name field', () => {
    expect(
      extractCustomerInfo({ firstName: 'Ada', lastName: 'Okafor' }).name,
    ).toBe('Ada Okafor');
  });

  it('ignores non-string and blank values', () => {
    expect(extractCustomerInfo({ name: 42, address: '  ' })).toEqual({
      name: null,
      address: null,
    });
  });
});
