import { IncomingMessage } from 'node:http';
import { resolveRequestId } from './logger.module';

const req = (id?: string | string[]) =>
  ({ headers: { 'x-request-id': id } }) as unknown as IncomingMessage;

describe('resolveRequestId', () => {
  it('reuses a sane incoming id', () => {
    expect(resolveRequestId(req('abc-123_X.y'))).toBe('abc-123_X.y');
  });

  it('replaces missing, oversized or unsafe ids with a uuid', () => {
    for (const bad of [undefined, 'a'.repeat(65), 'bad id\nx', '<script>']) {
      expect(resolveRequestId(req(bad))).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});
