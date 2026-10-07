import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { QoreIdWebhookController } from './qoreid-webhook.controller';
import { computeQoreIdSignature } from './qoreid-signature';

// Real HTTP round trip (raw-body capture + global pipes), mirroring main.ts.
const SECRET = 'http-test-secret';

describe('POST /webhooks/qoreid (HTTP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [QoreIdWebhookController],
      providers: [
        {
          provide: ConfigService,
          useValue: { get: () => SECRET },
        },
      ],
    }).compile();
    app = mod.createNestApplication({ rawBody: true, logger: false });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });
  afterAll(() => app.close());

  const post = (body: string, sig?: string) => {
    const r = request(app.getHttpServer() as Parameters<typeof request>[0])
      .post('/webhooks/qoreid')
      .set('Content-Type', 'application/json');
    if (sig) r.set('x-verifyme-signature', sig);
    return r.send(body);
  };

  it('accepts the empty {} test ping signed like QoreID (HMAC-SHA512 hex)', async () => {
    const res = await post('{}', computeQoreIdSignature('{}', SECRET));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'received' });
  });

  it('verifies against the exact bytes sent, including odd spacing', async () => {
    const raw = '{ "event" :  "verification",\n "status":"verified" }';
    const res = await post(raw, computeQoreIdSignature(raw, SECRET));
    expect(res.status).toBe(200);
  });

  it('401 for a missing, wrong or tampered signature', async () => {
    expect((await post('{}')).status).toBe(401);
    expect((await post('{}', 'abcd')).status).toBe(401);
    const sig = computeQoreIdSignature('{}', SECRET);
    expect((await post('{"x":1}', sig)).status).toBe(401);
  });
});
