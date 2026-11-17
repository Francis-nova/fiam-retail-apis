import { PushTemplate } from '@app/common';
import { renderPush } from './push-templates';

describe('renderPush amounts', () => {
  it('shows naira as ₦ when no currency is sent', () => {
    const push = renderPush(PushTemplate.MONEY_RECEIVED, { amount: '5000' });
    expect(push.body).toBe('₦5,000.00 has been added to your Fiam wallet.');
  });

  it('shows a stablecoin deposit in its own currency', () => {
    const push = renderPush(PushTemplate.MONEY_RECEIVED, {
      amount: '20.00000000',
      currency: 'USDC',
    });
    expect(push.body).toBe('20.00 USDC has been added to your Fiam wallet.');
  });
});
