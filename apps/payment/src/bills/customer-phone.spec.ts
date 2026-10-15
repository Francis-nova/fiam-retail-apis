import { toLocalNigerianPhone } from './customer-phone';

describe('toLocalNigerianPhone', () => {
  it('converts the stored 234… form to the local 0… form', () => {
    expect(toLocalNigerianPhone('2348012345678')).toBe('08012345678');
    expect(toLocalNigerianPhone('2349071046909')).toBe('09071046909');
  });

  it('returns null for anything that is not a Nigerian mobile', () => {
    expect(toLocalNigerianPhone(null)).toBeNull();
    expect(toLocalNigerianPhone(undefined)).toBeNull();
    expect(toLocalNigerianPhone('')).toBeNull();
    expect(toLocalNigerianPhone('08012345678')).toBeNull();
    expect(toLocalNigerianPhone('2341234567890')).toBeNull();
    expect(toLocalNigerianPhone('23480123')).toBeNull();
  });
});
