import * as Sentry from '@sentry/node';

let enabled = false;

// Drops everything that could carry customer data before an event leaves the
// server. These APIs handle PINs, passwords, identity numbers and documents, so
// the rule is: send the stack trace and the route, nothing from the request.
export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.request) {
    const { method, url } = event.request;
    event.request = {
      method,
      // Query strings can hold tokens/search terms.
      url: url?.split('?')[0],
    };
  }
  event.user = undefined;
  event.extra = undefined;
  event.contexts = { ...event.contexts, device: undefined };
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((b) => ({
      ...b,
      data: undefined,
    }));
  }
  return event;
}

/**
 * Starts error tracking when SENTRY_DSN is set; otherwise does nothing at all,
 * so local development and any environment without a DSN are unaffected.
 */
export function initErrorTracking(service: string): boolean {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'unknown',
    release: process.env.SENTRY_RELEASE,
    serverName: service,
    // Errors only: no performance traces (they carry URLs and timings).
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
  });
  Sentry.setTag('service', service);
  enabled = true;
  return true;
}

/** Reports an unexpected (5xx) error. A no-op unless tracking is enabled. */
export function captureServerError(err: unknown): void {
  if (!enabled) return;
  Sentry.captureException(err);
}
