import { join } from 'path';
import * as pug from 'pug';
import { EmailTemplate, subjectFor } from './email-templates';

const render = (data: Record<string, string>) =>
  pug.renderFile(join(__dirname, 'templates', 'bill-receipt.pug'), {
    logoUrl: 'https://example.test/logo.png',
    year: 2026,
    envLabel: '',
    ...data,
  });

const base = {
  firstName: 'Francis',
  name: 'Francis',
  billType: 'UTILITY',
  billTypeLabel: 'Electricity',
  customerLabel: 'Meter number',
  biller: 'IKEJA Electricity',
  plan: 'Ikeja Electric prepaid',
  paidFor: '45012345627',
  amount: '₦2,000.00',
  total: '₦2,100.00',
  fee: '₦100.00',
  reference: 'ADL-B595781518',
  status: 'Successful',
  occurredAt: '16 Oct 2026, 21:17',
};

describe('bill-receipt email', () => {
  it('shows the token, what it was for and the details', () => {
    const html = render({
      ...base,
      hasToken: 'true',
      token: '1234 5678 9012 3456 7890',
    });
    expect(html).toContain('Your electricity token');
    expect(html).toContain('1234 5678 9012 3456 7890');
    expect(html).toContain('IKEJA Electricity');
    expect(html).toContain('Meter number');
    expect(html).toContain('45012345627');
    expect(html).toContain('-₦2,100.00');
    expect(html).toContain('₦100.00');
    expect(html).toContain('ADL-B595781518');
    expect(html).toContain('prepaid meter');
    expect(html).not.toContain('Money sent');
    expect(html).not.toContain("hasn't been issued");
  });

  it('lists key change tokens before the energy token, in order', () => {
    const html = render({
      ...base,
      hasToken: 'true',
      token: '3333 3333 3333',
      extra1Label: 'Key change token 1',
      extra1: '1111 1111',
      extra2Label: 'Key change token 2',
      extra2: '2222 2222',
    });
    const a = html.indexOf('Key change token 1');
    const b = html.indexOf('Key change token 2');
    const c = html.indexOf('Energy token');
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
  });

  it('says plainly when the token has not been issued', () => {
    const html = render({ ...base, tokenMissing: 'true' });
    expect(html).toContain("token hasn't been issued yet");
    expect(html).toContain('ADL-B595781518');
    expect(html).not.toContain('Your electricity token');
  });

  it('is a plain confirmation for airtime: no token box, no fee row when free', () => {
    const html = render({
      ...base,
      billType: 'AIRTIME',
      billTypeLabel: 'Airtime',
      customerLabel: 'Phone number',
      biller: 'MTN',
      plan: 'MTN',
      total: '₦1,000.00',
      amount: '₦1,000.00',
      fee: '',
    });
    expect(html).toContain('Airtime payment successful');
    expect(html).toContain('Phone number');
    expect(html).not.toContain('prepaid meter');
    expect(html).not.toContain('>Fee<');
    // plan equal to the biller isn't repeated
    expect(html).not.toContain('>Plan<');
  });
});

describe('bill-receipt subject', () => {
  it('leads with the token when there is one', () => {
    expect(
      subjectFor(EmailTemplate.BILL_RECEIPT, {
        billTypeLabel: 'Electricity',
        hasToken: 'true',
      }),
    ).toBe('Your electricity token');
  });
  it('is a confirmation otherwise', () => {
    expect(
      subjectFor(EmailTemplate.BILL_RECEIPT, { billTypeLabel: 'Airtime' }),
    ).toBe('Airtime payment successful');
    expect(
      subjectFor(EmailTemplate.BILL_RECEIPT, {
        billTypeLabel: 'Electricity',
        tokenMissing: 'true',
      }),
    ).toBe('Electricity payment successful');
  });
});
