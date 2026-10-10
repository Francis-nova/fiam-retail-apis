import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { RmqRecordBuilder } from '@nestjs/microservices';

export const REQUEST_ID_HEADER = 'x-request-id';

const storage = new AsyncLocalStorage<{ requestId: string }>();

/** The id of the HTTP request / queue message / job being handled, if any. */
export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return storage.run({ requestId }, fn);
}

/**
 * RabbitMQ publish: wraps `data` so the current request id travels in the
 * message headers. Without an active id (cron, startup) it sends `data`
 * unchanged and the consumer mints its own.
 */
export function withRequestId<T>(data: T) {
  const requestId = getRequestId();
  if (!requestId) return data;
  return new RmqRecordBuilder(data)
    .setOptions({ headers: { [REQUEST_ID_HEADER]: requestId } })
    .build();
}

interface RmqMessageLike {
  getMessage(): unknown;
}

/** RabbitMQ consume: runs `fn` under the id the publisher sent (or a new one). */
export function runWithMessageRequestId<T>(
  context: RmqMessageLike,
  fn: () => T,
): T {
  const headers = (
    context.getMessage() as {
      properties?: { headers?: Record<string, unknown> };
    }
  ).properties?.headers;
  const incoming = headers?.[REQUEST_ID_HEADER];
  return runWithRequestId(
    typeof incoming === 'string' && incoming ? incoming : randomUUID(),
    fn,
  );
}

/** BullMQ enqueue: stamps the current request id onto the job data. */
export function withJobRequestId<T extends object>(
  data: T,
): T & { requestId?: string } {
  const requestId = getRequestId();
  return requestId ? { ...data, requestId } : data;
}

/** BullMQ process / event handlers: runs `fn` under the job's request id. */
export function runWithJobRequestId<T>(
  job: { data?: { requestId?: string } } | undefined,
  fn: () => T,
): T {
  return runWithRequestId(job?.data?.requestId ?? randomUUID(), fn);
}
