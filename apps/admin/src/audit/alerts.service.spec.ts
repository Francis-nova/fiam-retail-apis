/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest mock calls are untyped `any` by design */
import { AlertsService, ALERT_ACTIONS } from './alerts.service';

function make(
  opts: {
    url?: string;
    admins?: { email: string; fullName: string }[];
    findFails?: boolean;
  } = {},
) {
  const emit = jest.fn();
  const find = opts.findFails
    ? jest.fn().mockRejectedValue(new Error('db down'))
    : jest.fn().mockResolvedValue(
        opts.admins ?? [
          { email: 'a@fiam.ng', fullName: 'Ada Obi' },
          { email: 'b@fiam.ng', fullName: 'Bayo Lawal' },
        ],
      );
  const svc = new AlertsService(
    { emit } as never,
    { find } as never,
    { get: () => ({ url: opts.url ?? 'amqp://x' }) } as never,
  );
  return { svc, emit, find };
}

describe('AlertsService', () => {
  it('emails every active super admin for a high-risk action', async () => {
    const { svc, emit } = make();
    await svc.notify({
      action: 'staff.deleted',
      staffEmail: 'boss@fiam.ng',
      resourceType: 'staff',
      resourceId: 'u1',
      ip: '1.2.3.4',
    });
    expect(emit).toHaveBeenCalledTimes(2);
    const [, msg] = emit.mock.calls[0];
    expect(msg).toMatchObject({
      channel: 'email',
      recipient: 'a@fiam.ng',
      template: 'staff-alert',
      data: {
        firstName: 'Ada',
        title: ALERT_ACTIONS['staff.deleted'],
        actor: 'boss@fiam.ng',
        ipAddress: '1.2.3.4',
      },
    });
  });

  it('stays quiet for routine actions', async () => {
    const { svc, emit, find } = make();
    for (const action of [
      'auth.login',
      'customer.viewed',
      'transaction.viewed',
      'kyc.document_viewed',
    ]) {
      await svc.notify({ action });
    }
    expect(emit).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });

  it('is off when RabbitMQ is not configured', async () => {
    const { svc, emit } = make({ url: '' });
    await svc.notify({ action: 'staff.created' });
    expect(emit).not.toHaveBeenCalled();
  });

  it('never throws, even if the lookup fails', async () => {
    const { svc } = make({ findFails: true });
    await expect(
      svc.notify({ action: 'staff.created' }),
    ).resolves.toBeUndefined();
  });
});
