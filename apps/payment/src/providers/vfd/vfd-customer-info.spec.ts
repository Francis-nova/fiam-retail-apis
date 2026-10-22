import { extractCustomerInfo } from './vfd-customer-info';

describe('extractCustomerInfo', () => {
  it('returns nothing for the empty object VFD documents', () => {
    expect(extractCustomerInfo({})).toEqual({
      name: null,
      address: null,
      details: [],
    });
    expect(extractCustomerInfo(undefined)).toEqual({
      name: null,
      address: null,
      details: [],
    });
    expect(extractCustomerInfo('x')).toEqual({
      name: null,
      address: null,
      details: [],
    });
  });

  it('finds the usual name and address fields', () => {
    expect(
      extractCustomerInfo({
        customerName: ' ADA  OKAFOR ',
        address: '1 Allen Ave',
      }),
    ).toEqual({
      name: 'ADA OKAFOR',
      address: '1 Allen Ave',
      details: [
        { label: 'Customer name', value: 'ADA OKAFOR' },
        { label: 'Address', value: '1 Allen Ave' },
      ],
    });
    expect(
      extractCustomerInfo({ name: 'Ada', Address: 'Lagos' }),
    ).toMatchObject({ name: 'Ada', address: 'Lagos' });
  });

  it('joins first and last name when there is no single name field', () => {
    expect(
      extractCustomerInfo({ firstName: 'Ada', lastName: 'Okafor' }).name,
    ).toBe('Ada Okafor');
  });

  it('ignores non-string and blank values', () => {
    expect(extractCustomerInfo({ name: 42, address: '  ' })).toMatchObject({
      name: null,
      address: null,
    });
  });

  it('lists every readable field, labelled, skipping blanks and arrays', () => {
    expect(
      extractCustomerInfo({
        meterNumber: '45012345627',
        tariff_class: 'R2',
        arrears: 0,
        note: '  ',
        tags: ['x'],
      }).details,
    ).toEqual([
      { label: 'Meter number', value: '45012345627' },
      { label: 'Tariff class', value: 'R2' },
      { label: 'Arrears', value: '0' },
    ]);
  });
});

describe('extractCustomerInfo with a wrapped biller response', () => {
  it('reads the holder from responseData and drops the wrapper fields', () => {
    const info = extractCustomerInfo({
      error: false,
      status: 'success',
      message: 'ok',
      responseCode: '00',
      responseData: { customerName: 'ADA OKAFOR', address: '1 Allen Ave' },
    });
    expect(info.name).toBe('ADA OKAFOR');
    expect(info.address).toBe('1 Allen Ave');
    expect(info.details).toEqual([
      { label: 'Customer name', value: 'ADA OKAFOR' },
      { label: 'Address', value: '1 Allen Ave' },
    ]);
  });
});
