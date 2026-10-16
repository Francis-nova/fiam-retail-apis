import { getRequestId } from './request-context';
import { safeJson } from '../logging/redact';

// Posts server errors to a Slack channel through an incoming webhook
// (SLACK_WEBHOOK_ERRORS). Unset = does nothing at all. Fire-and-forget: a
// Slack outage is swallowed, so reporting can never fail or slow a request.
//
// These APIs handle PINs, identity numbers and account numbers, so what leaves
// the server is deliberately narrow: service, route (no query string), request
// id, user id, the error and its stack trace, run through sanitizeForSlack().
// Request bodies and headers are never included.

export interface ErrorContext {
  status?: number;
  method?: string;
  url?: string;
  userId?: string;
  requestId?: string;
}

const DEDUPE_MS = 5 * 60_000;
const MAX_PER_MINUTE = 20;
const MAX_MESSAGE = 700;
const MAX_STACK = 2800;
const MAX_TRACKED = 200;
const POST_TIMEOUT_MS = 5_000;

let service = 'unknown';
const seen = new Map<string, { at: number; suppressed: number }>();
let windowStart = 0;
let windowCount = 0;

// Strips what could identify a customer or unlock something: credentials in
// URLs, bearer tokens, JWTs, emails and long digit runs (BVN, NIN, phone and
// account numbers). Digits inside ids like a UUID are left alone.
export function sanitizeForSlack(text: string): string {
  return text
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1[credentials]@')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [token]')
    .replace(
      /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
      '[jwt]',
    )
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')
    .replace(/(?<![\w-])\d{10,}(?![\w-])/g, '[digits]');
}

// Library frames bury the application's own code, and the length cap could cut
// the useful part off: keep the first line (the error) and every frame that
// isn't inside node_modules or Node's internals.
export function trimStack(stack: string): string {
  const lines = stack.split('\n');
  const kept = lines.filter(
    (line, i) =>
      i === 0 ||
      !line.trim().startsWith('at ') ||
      !/node_modules|node:internal/.test(line),
  );
  const dropped = lines.length - kept.length;
  return dropped > 0
    ? `${kept.join('\n')}\n    … ${dropped} library frame(s) omitted`
    : kept.join('\n');
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… (truncated)` : text;
}

function webhookUrl(): string {
  return process.env.SLACK_WEBHOOK_ERRORS ?? '';
}

function environment(): string {
  return process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'unknown';
}

// Same error repeating (a down dependency, a bad deploy) would bury the
// channel: one message per fingerprint per window, with a count of what was
// held back appended to the next one. A global cap backs that up.
function allow(
  fingerprint: string,
  now: number,
): { send: boolean; held: number } {
  if (now - windowStart > 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  const previous = seen.get(fingerprint);
  if (previous && now - previous.at < DEDUPE_MS) {
    previous.suppressed += 1;
    return { send: false, held: 0 };
  }
  if (windowCount >= MAX_PER_MINUTE) return { send: false, held: 0 };
  windowCount += 1;
  if (seen.size >= MAX_TRACKED) {
    const oldest: string | undefined = seen.keys().next().value as
      string | undefined;
    if (oldest !== undefined) seen.delete(oldest);
  }
  const held = previous?.suppressed ?? 0;
  seen.set(fingerprint, { at: now, suppressed: 0 });
  return { send: true, held };
}

function post(text: string): void {
  const url = webhookUrl();
  if (!url) return;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(POST_TIMEOUT_MS),
  }).catch(() => undefined);
}

function describe(err: unknown): {
  name: string;
  message: string;
  stack: string;
} {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack ?? '' };
  }
  return { name: 'NonError', message: safeJson(err), stack: '' };
}

export function reportErrorToSlack(err: unknown, ctx: ErrorContext = {}): void {
  if (!webhookUrl()) return;
  try {
    const { name, message, stack } = describe(err);
    const cleanMessage = clip(sanitizeForSlack(message), MAX_MESSAGE);
    const cleanStack = clip(sanitizeForSlack(trimStack(stack)), MAX_STACK);
    const firstFrame =
      stack.split('\n').find((l) => l.trim().startsWith('at ')) ?? '';
    const fingerprint = [
      service,
      name,
      message.replace(/\d+/g, '#'),
      firstFrame,
    ].join('|');
    const { send, held } = allow(fingerprint, Date.now());
    if (!send) return;

    const route =
      ctx.method && ctx.url ? ` on ${ctx.method} ${ctx.url.split('?')[0]}` : '';
    const lines = [
      `:rotating_light: *${service}* · ${environment()} — ${ctx.status ?? 500}${route}`,
      `*${name}*: ${cleanMessage}`,
      [
        `request: ${ctx.requestId ?? getRequestId() ?? 'n/a'}`,
        ctx.userId ? `user: ${ctx.userId}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    ];
    if (held > 0)
      lines.push(
        `_${held} similar error(s) were held back since the last alert._`,
      );
    if (cleanStack) lines.push('```' + cleanStack + '```');
    post(lines.join('\n'));
  } catch {
    // Reporting must never throw into the caller.
  }
}

// For failures that aren't exceptions — a provider rejecting a payment, funds
// put on hold, a status check giving up. `details` should be identifiers and
// provider codes/messages, never customer data.
export function reportIssueToSlack(
  title: string,
  details: Record<string, string | number | null | undefined> = {},
): void {
  if (!webhookUrl()) return;
  try {
    const body = Object.entries(details)
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `• ${k}: ${clip(sanitizeForSlack(String(v)), 300)}`);
    const fingerprint = [service, title, ...body].join('|');
    const { send, held } = allow(fingerprint, Date.now());
    if (!send) return;
    const lines = [
      `:warning: *${service}* · ${environment()} — ${title}`,
      ...body,
    ];
    if (held > 0) lines.push(`_${held} identical alert(s) were held back._`);
    post(lines.join('\n'));
  } catch {
    // never throw into the caller
  }
}

// Reports crashes that never reach the HTTP filter (a rejected promise nobody
// awaited, an exception in a background worker). `uncaughtExceptionMonitor`
// only observes: Node still terminates the process exactly as it would have.
export function initSlackErrorReporting(serviceName: string): void {
  service = serviceName;
  process.on('uncaughtExceptionMonitor', (err) => {
    reportErrorToSlack(err, { status: 500 });
  });
}

// For tests.
export function resetSlackErrorReporterForTests(): void {
  seen.clear();
  windowStart = 0;
  windowCount = 0;
}
