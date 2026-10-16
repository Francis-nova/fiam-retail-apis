import Decimal from 'decimal.js';
import { VfdPaymentProvider } from './vfd-payment.provider';

// Pins the /pay request body to section 3.5 of VFD's bills docs.
describe('VfdPaymentProvider.payBill request', () => {
  function setup() {
    const provider = new VfdPaymentProvider({
      get: () => ({ billsBaseUrl: 'https://bills.test' }),
    } as never);
    const authorizedFetch = jest.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({ status: '00', data: { reference: 'ADL-B1' } }),
    });
    (provider as unknown as { authorizedFetch: unknown }).authorizedFetch =
      authorizedFetch;
    return { provider, authorizedFetch };
  }

  const input = {
    customerId: '45012345627',
    amount: new Decimal('2000'),
    biller: { id: 'IKEDC', division: 'F', product: '408' },
    paymentItem: 'IKEDC_PREPAID',
    reference: 'ADL-B541767627',
    phoneNumber: '08030000000',
  };

  it('sends exactly the documented fields, amount as a string', async () => {
    const { provider, authorizedFetch } = setup();
    await provider.payBill(input);
    const [url, init] = authorizedFetch.mock.calls[0] as [
      string,
      { method: string; body: string },
    ];
    expect(url).toBe('https://bills.test/pay');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      customerId: '45012345627',
      amount: '2000',
      division: 'F',
      paymentItem: 'IKEDC_PREPAID',
      productId: '408',
      billerId: 'IKEDC',
      reference: 'ADL-B541767627',
      phoneNumber: '08030000000',
    });
  });

  it('leaves phoneNumber out when there is none', async () => {
    const { provider, authorizedFetch } = setup();
    await provider.payBill({ ...input, phoneNumber: null });
    const [, init] = authorizedFetch.mock.calls[0] as [
      string,
      { body: string },
    ];
    expect(JSON.parse(init.body)).not.toHaveProperty('phoneNumber');
  });
});
