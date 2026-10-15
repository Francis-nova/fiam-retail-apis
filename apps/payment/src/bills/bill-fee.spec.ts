import { calculateBillFees } from './bill-fee';

const biller = (category: string, convenienceFee: string | null = null) => ({
  category,
  convenienceFee,
});

describe('calculateBillFees', () => {
  it('charges nothing extra on airtime and data', () => {
    expect(calculateBillFees(biller('Airtime'), '100').total.toString()).toBe(
      '0',
    );
    expect(calculateBillFees(biller('Data'), '100').total.toString()).toBe('0');
  });

  it('charges the configured flat fee on every other category', () => {
    for (const category of [
      'Utility',
      'Cable TV',
      'Internet Subscription',
      'Betting',
      'Something New',
    ]) {
      expect(calculateBillFees(biller(category), '100').total.toString()).toBe(
        '100',
      );
    }
  });

  it('follows the configured value, including zero', () => {
    expect(
      calculateBillFees(biller('Utility'), '150.50').total.toString(),
    ).toBe('150.5');
    expect(calculateBillFees(biller('Utility'), '0').total.toString()).toBe(
      '0',
    );
  });

  it("adds the provider's own convenience fee on top", () => {
    const fees = calculateBillFees(biller('Data', '30'), '100');
    expect(fees.convenienceFee.toString()).toBe('30');
    expect(fees.serviceFee.toString()).toBe('0');
    expect(fees.total.toString()).toBe('30');
    expect(
      calculateBillFees(biller('Utility', '30'), '100').total.toString(),
    ).toBe('130');
  });

  it('treats category case/spacing the way the rest of the code does', () => {
    expect(calculateBillFees(biller(' airtime '), '100').total.toString()).toBe(
      '0',
    );
  });
});
