import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { DynamicModule } from '@nestjs/common';
import { getRequestId, runWithRequestId } from './request-context';
import { LoggerModule } from 'nestjs-pino';

const MAX_REQUEST_ID_LENGTH = 64;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]+$/;

// Reuses the edge's request id (Traefik / mobile client) when it looks sane,
// so one call can be followed across services; otherwise mints a new one.
export function resolveRequestId(
  req: IncomingMessage,
  res?: ServerResponse,
): string {
  const header = req.headers['x-request-id'];
  const incoming = Array.isArray(header) ? header[0] : header;
  const id =
    incoming &&
    incoming.length <= MAX_REQUEST_ID_LENGTH &&
    SAFE_REQUEST_ID.test(incoming)
      ? incoming
      : randomUUID();
  res?.setHeader('x-request-id', id);
  return id;
}

type RequestWithId = IncomingMessage & { id?: string };

// Makes the request id available to everything the request touches (logs,
// queue publishes) without threading it through every function. pino-http
// reuses `req.id` when set, so both middlewares agree whichever runs first.
export function requestContextMiddleware(
  req: RequestWithId,
  res: ServerResponse,
  next: () => void,
): void {
  const id = req.id ? String(req.id) : resolveRequestId(req, res);
  req.id = id;
  runWithRequestId(id, next);
}

/**
 * JSON request/application logging via pino. Every line carries the service
 * name and request id. Headers, bodies and query strings are never logged;
 * only method, path, status and timing are.
 */
export class AppLoggerModule {
  static forRoot(service: string): DynamicModule {
    return LoggerModule.forRoot({
      pinoHttp: {
        level:
          process.env.LOG_LEVEL ??
          (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
        base: { service },
        // Adds the request id to lines logged outside the HTTP request itself
        // (queue consumers, job processors).
        mixin: () => {
          const requestId = getRequestId();
          return requestId ? { requestId } : {};
        },
        genReqId: resolveRequestId,
        // Health probes fire every few seconds and would drown real traffic.
        autoLogging: {
          ignore: (req) => req.url?.startsWith('/health') ?? false,
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
          ],
          censor: '[REDACTED]',
        },
        serializers: {
          req: (req: { id: string; method: string; url: string }) => ({
            id: req.id,
            method: req.method,
            // Query strings can hold tokens/search terms.
            url: req.url?.split('?')[0],
          }),
          res: (res: { statusCode: number }) => ({
            statusCode: res.statusCode,
          }),
        },
      },
    });
  }
}
