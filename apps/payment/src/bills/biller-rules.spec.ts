import { BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { assertBillerRules } from './biller-rules';

const run = (
  biller: { id: string; name: string },
  item: string,
  amount: string,
  phoneNumber?: string | null,
) =>
  assertBillerRules({
    biller,
    item: { name: item },
    amount: new Decimal(amount),
    phoneNumber,
  });

describe('assertBillerRules', () => {
  const ikedc = { id: 'ikedc', name: 'IKEDC Prepaid' };
  const ibedc = { id: 'ibedc', name: 'IBEDC Prepaid' };

  it('requires a phone number for IKEDC', () => {
    expect(() => run(ikedc, 'Prepaid', '2000')).toThrow(BadRequestException);
    expect(() => run(ikedc, 'Prepaid', '2000', '  ')).toThrow(
      BadRequestException,
    );
    expect(() => run(ikedc, 'Prepaid', '2000', '08012345678')).not.toThrow();
  });

  it('does not require a phone number for other billers', () => {
    expect(() =>
      run({ id: 'dstv', name: 'DSTV' }, 'Compact', '2150'),
    ).not.toThrow();
  });

  it('enforces the IBEDC Band A minimum', () => {
    expect(() => run(ibedc, 'Prepaid Band A', '4999.99')).toThrow(
      BadRequestException,
    );
    expect(() => run(ibedc, 'Prepaid Band A', '5000')).not.toThrow();
  });

  it('leaves other IBEDC bands and billers alone', () => {
    expect(() => run(ibedc, 'Prepaid Band B', '1000')).not.toThrow();
    expect(() => run(ikedc, 'Band A', '100', '08012345678')).not.toThrow();
  });
});
