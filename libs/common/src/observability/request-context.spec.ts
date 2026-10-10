import { RmqRecord } from '@nestjs/microservices';
import {
  getRequestId,
  runWithJobRequestId,
  runWithMessageRequestId,
  runWithRequestId,
  withJobRequestId,
  withRequestId,
} from './request-context';

const ctx = (headers?: Record<string, unknown>) => ({
  getMessage: () => ({ properties: { headers } }),
});

describe('request context propagation', () => {
  it('has no id outside a request', () => {
    expect(getRequestId()).toBeUndefined();
    const data = { a: 1 };
    expect(withRequestId(data)).toBe(data);
    expect(withJobRequestId(data)).toBe(data);
  });

  it('carries the id onto RabbitMQ messages and back off them', () => {
    const record = runWithRequestId('req-1', () =>
      withRequestId({ a: 1 }),
    ) as RmqRecord;
    expect(record.data).toEqual({ a: 1 });
    expect(record.options?.headers).toEqual({ 'x-request-id': 'req-1' });

    const seen = runWithMessageRequestId(
      ctx(record.options?.headers),
      getRequestId,
    );
    expect(seen).toBe('req-1');
  });

  it('mints an id for messages that arrive without one', () => {
    expect(runWithMessageRequestId(ctx(), getRequestId)).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });

  it('carries the id through BullMQ job data', () => {
    const data = runWithRequestId('req-2', () => withJobRequestId({ t: 'x' }));
    expect(data).toEqual({ t: 'x', requestId: 'req-2' });
    expect(runWithJobRequestId({ data }, getRequestId)).toBe('req-2');
    expect(runWithJobRequestId(undefined, getRequestId)).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });
});
