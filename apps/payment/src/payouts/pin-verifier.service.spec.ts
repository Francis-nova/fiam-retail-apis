import { ConfigService } from '@nestjs/config';
import { PinVerifierService } from './pin-verifier.service';

function makeService(key = 'k'.repeat(32)) {
  const config = {
    get: () => ({ internalUrl: 'http://auth:7001', internalApiKey: key }),
  } as unknown as ConfigService<never, true>;
  return new PinVerifierService(config);
}

function mockFetch(status: number) {
  const fn = jest.fn().mockResolvedValue({ ok: status < 300, status });
  global.fetch = fn;
  return fn;
}

describe('PinVerifierService', () => {
  it('passes on 204 and calls the internal endpoint with the key and PIN', async () => {
    const fetchMock = mockFetch(204);
    await expect(
      makeService().assertValid('u1', '1234'),
    ).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://auth:7001/internal/users/u1/verify-pin');
    expect((init.headers as Record<string, string>)['x-internal-key']).toBe(
      'k'.repeat(32),
    );
    expect(init.body).toBe(JSON.stringify({ pin: '1234' }));
  });

  it('maps a wrong PIN to 403 (not 401, which would sign the customer out)', async () => {
    mockFetch(401);
    await expect(makeService().assertValid('u1', '0000')).rejects.toMatchObject(
      { status: 403 },
    );
  });

  it('passes a lockout through as 429', async () => {
    mockFetch(429);
    await expect(makeService().assertValid('u1', '0000')).rejects.toMatchObject(
      { status: 429 },
    );
  });

  it('fails closed when auth errors, is unreachable, or the key is missing', async () => {
    mockFetch(500);
    await expect(makeService().assertValid('u1', '1234')).rejects.toMatchObject(
      { status: 503 },
    );
    global.fetch = jest.fn().mockRejectedValue(new Error('down'));
    await expect(makeService().assertValid('u1', '1234')).rejects.toMatchObject(
      { status: 503 },
    );
    await expect(
      makeService('').assertValid('u1', '1234'),
    ).rejects.toMatchObject({ status: 503 });
  });
});
