import { of, lastValueFrom } from 'rxjs';
import {
  REFRESH_COOKIE,
  RefreshCookieInterceptor,
  readRefreshCookie,
} from './refresh-cookie';

const config = { get: () => ({ refreshTtlDays: 7 }) } as never;

function run(body: unknown) {
  const res = { cookie: jest.fn(), clearCookie: jest.fn() };
  const ctx = { switchToHttp: () => ({ getResponse: () => res }) } as never;
  const out = new RefreshCookieInterceptor(config).intercept(ctx, {
    handle: () => of(body),
  });
  return { res, result: lastValueFrom(out) };
}

describe('refresh token cookie', () => {
  it('moves the refresh token into an HttpOnly, SameSite=Strict, /auth-scoped cookie', async () => {
    const { res, result } = run({
      accessToken: 'a',
      refreshToken: 'secret-rt',
      staff: { id: 1 },
    });
    const body = (await result) as Record<string, unknown>;
    expect(body).toEqual({ accessToken: 'a', staff: { id: 1 } });
    expect(JSON.stringify(body)).not.toContain('secret-rt');
    expect(res.cookie).toHaveBeenCalledWith(
      REFRESH_COOKIE,
      'secret-rt',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'strict',
        path: '/auth',
        maxAge: 7 * 86_400_000,
      }),
    );
  });

  it('leaves bodies without a refresh token (mfa step, errors, me) untouched', async () => {
    const { res, result } = run({ mfa: 'verify', mfaToken: 't' });
    expect(await result).toEqual({ mfa: 'verify', mfaToken: 't' });
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('reads the cookie back out of a Cookie header', () => {
    const req = (cookie?: string) => ({ headers: { cookie } }) as never;
    expect(
      readRefreshCookie(req(`other=1; ${REFRESH_COOKIE}=abc%2Fdef==; x=2`)),
    ).toBe('abc/def==');
    expect(readRefreshCookie(req('other=1'))).toBeNull();
    expect(readRefreshCookie(req(undefined))).toBeNull();
    expect(readRefreshCookie(req(`${REFRESH_COOKIE}=`))).toBeNull();
  });
});
