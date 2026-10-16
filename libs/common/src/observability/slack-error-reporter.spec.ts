import {
  initSlackErrorReporting,
  reportErrorToSlack,
  reportIssueToSlack,
  resetSlackErrorReporterForTests,
  sanitizeForSlack,
  trimStack,
} from './slack-error-reporter';

describe('sanitizeForSlack', () => {
  it('removes credentials, tokens, emails and long digit runs', () => {
    const out = sanitizeForSlack(
      'connect postgres://admin:hunter2@db:5432/x failed for a.b@c.com ' +
        'Bearer abc.def.ghi bvn 22412345678 acct 0123456789 ' +
        'jwt eyJhbGciOi.eyJzdWIiOiIx.sig',
    );
    for (const secret of [
      'hunter2',
      'a.b@c.com',
      'abc.def.ghi',
      '22412345678',
      '0123456789',
      'eyJhbGciOi',
    ]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('postgres://[credentials]@db:5432/x');
  });

  it('keeps ids and short numbers that help debugging', () => {
    const out = sanitizeForSlack(
      'tx 8f4e2c1a-0000-4b3d-9d5e-123456789012 ref ADLB541767627 line 42',
    );
    expect(out).toContain('8f4e2c1a-0000-4b3d-9d5e-123456789012');
    expect(out).toContain('ADLB541767627');
    expect(out).toContain('line 42');
  });
});

describe('trimStack', () => {
  it('keeps the error line and our own frames, drops library frames', () => {
    const stack = [
      'Error: boom',
      '    at Query.run (/app/node_modules/typeorm/x.js:1:1)',
      '    at BillsService.pay (/app/dist/bills.service.js:10:5)',
      '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
    ].join('\n');
    const out = trimStack(stack);
    expect(out).toContain('Error: boom');
    expect(out).toContain('BillsService.pay');
    expect(out).not.toContain('typeorm');
    expect(out).not.toContain('node:internal');
    expect(out).toContain('2 library frame(s) omitted');
  });

  it('leaves a stack with only our frames untouched', () => {
    const stack = 'Error: x\n    at A.b (/app/dist/a.js:1:1)';
    expect(trimStack(stack)).toBe(stack);
  });
});

describe('Slack error reporter', () => {
  const fetchMock = jest.fn().mockResolvedValue({ ok: true });
  const realFetch = global.fetch;

  beforeEach(() => {
    process.env.SLACK_WEBHOOK_ERRORS = 'https://hooks.slack.test/x';
    process.env.NODE_ENV = 'production';
    fetchMock.mockClear();
    global.fetch = fetchMock as never;
    resetSlackErrorReporterForTests();
    initSlackErrorReporting('payment');
  });
  afterAll(() => {
    global.fetch = realFetch;
    delete process.env.SLACK_WEBHOOK_ERRORS;
  });

  const sent = () => {
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    return (JSON.parse(init.body) as { text: string }).text;
  };

  it('does nothing without a webhook', () => {
    delete process.env.SLACK_WEBHOOK_ERRORS;
    reportErrorToSlack(new Error('boom'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the service, route, request, error and stack trace, sanitised', () => {
    const err = new TypeError('cannot read x for user a@b.com bvn 22412345678');
    reportErrorToSlack(err, {
      status: 500,
      method: 'POST',
      url: '/bills/pay?token=secret',
      userId: 'u-1',
      requestId: 'req-1',
    });
    const text = sent();
    expect(text).toContain('*payment*');
    expect(text).toContain('production');
    expect(text).toContain('POST /bills/pay');
    expect(text).not.toContain('token=secret');
    expect(text).toContain('request: req-1');
    expect(text).toContain('user: u-1');
    expect(text).toContain('*TypeError*');
    expect(text).toContain('```');
    expect(text).toContain('at ');
    expect(text).not.toContain('a@b.com');
    expect(text).not.toContain('22412345678');
  });

  it('sends a repeating error once, then notes how many were held back', () => {
    for (let i = 0; i < 4; i++) reportErrorToSlack(new Error('db down'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats errors thrown from one place that differ only by numbers as the same', () => {
    const timeout = (ms: number) => new Error(`timeout after ${ms} ms`);
    reportErrorToSlack(timeout(3000));
    reportErrorToSlack(timeout(5000));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caps the volume of distinct errors per minute', () => {
    for (let i = 0; i < 40; i++)
      reportErrorToSlack(new Error(`distinct failure ${'x'.repeat(i)}`));
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it('reports an issue with its details and drops empty ones', () => {
    reportIssueToSlack('Bill payment failed at provider', {
      reference: 'ADL-B1',
      message: 'Not in the recent documentation',
      empty: null,
    });
    const text = sent();
    expect(text).toContain('Bill payment failed at provider');
    expect(text).toContain('• reference: ADL-B1');
    expect(text).toContain('• message: Not in the recent documentation');
    expect(text).not.toContain('empty');
  });

  it('never throws, even when the webhook call rejects', () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    expect(() => reportErrorToSlack(new Error('x1'))).not.toThrow();
  });
});
