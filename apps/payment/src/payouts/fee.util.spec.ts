import Decimal from 'decimal.js';
import { stampDuty, withVat } from './fee.util';

describe('withVat', () => {
  it.each([
    ['10', '10.75'],
    ['25', '26.88'],
    ['50', '53.75'],
  ])('adds 7.5%% to %s', (fee, expected) => {
    expect(withVat(new Decimal(fee)).toFixed(2)).toBe(expected);
  });
});

describe('stampDuty', () => {
  it.each([
    ['9999.99', '0'],
    ['10000', '50'],
    ['250000', '50'],
  ])('on %s', (amount, expected) => {
    expect(stampDuty(new Decimal(amount)).toString()).toBe(expected);
  });
});
