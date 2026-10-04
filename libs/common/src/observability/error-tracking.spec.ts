import { scrubEvent } from './error-tracking';

describe('scrubEvent', () => {
  it('keeps the stack but drops request bodies, headers, cookies, query strings and user data', () => {
    const event = {
      type: undefined,
      message: 'boom',
      exception: { values: [{ type: 'Error', value: 'boom' }] },
      request: {
        method: 'POST',
        url: 'https://api.example/auth/login?token=secret&email=a@b.c',
        data: { password: 'hunter2', pin: '1234' },
        headers: { authorization: 'Bearer abc', cookie: 'rt=xyz' },
        cookies: { rt: 'xyz' },
        query_string: 'token=secret',
      },
      user: { id: 'u1', email: 'a@b.c', ip_address: '1.2.3.4' },
      extra: { body: { pin: '1234' } },
      breadcrumbs: [{ message: 'http', data: { url: 'https://x?pin=1234' } }],
    } as never;

    const out = JSON.stringify(scrubEvent(event));
    for (const secret of [
      'hunter2',
      '1234',
      'Bearer abc',
      'xyz',
      'token=secret',
      'a@b.c',
      '1.2.3.4',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('boom');
    expect(out).toContain('"method":"POST"');
    expect(out).toContain('https://api.example/auth/login');
  });
});
