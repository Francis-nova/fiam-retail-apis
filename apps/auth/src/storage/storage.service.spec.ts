/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- the minio client is mocked */
const put = jest.fn().mockResolvedValue(undefined);
const get = jest.fn().mockResolvedValue('stream');
const remove = jest.fn().mockResolvedValue(undefined);
jest.mock('minio', () => ({
  Client: jest.fn().mockImplementation(() => ({
    putObject: put,
    getObject: get,
    removeObject: remove,
    bucketExists: jest.fn().mockResolvedValue(true),
    makeBucket: jest.fn(),
  })),
}));

import * as Minio from 'minio';
import { StorageService, normalizePrefix } from './storage.service';

const make = (over: Record<string, unknown> = {}) =>
  new StorageService({
    get: () => ({
      endpoint: 'fsn1.your-objectstorage.com',
      port: 443,
      useSsl: true,
      accessKey: 'a',
      secretKey: 's',
      bucket: 'shared-bucket',
      region: 'fsn1',
      autoCreateBucket: false,
      keyPrefix: 'fiam-staging',
      ...over,
    }),
  } as never);

describe('normalizePrefix', () => {
  it.each([
    ['fiam-staging', 'fiam-staging/'],
    ['/fiam-staging/', 'fiam-staging/'],
    ['a/b', 'a/b/'],
    ['', ''],
    ['  ', ''],
    [undefined, ''],
  ])('%j -> %j', (input, out) =>
    expect(normalizePrefix(input as string)).toBe(out),
  );
});

describe('StorageService key prefix', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps every object inside its folder: upload, read and delete', async () => {
    const svc = make();
    await svc.upload('kyc/u1/FRONT/x.jpeg', Buffer.from('abc'), 'image/jpeg');
    await svc.getObject('kyc/u1/FRONT/x.jpeg');
    await svc.remove('kyc/u1/FRONT/x.jpeg');
    expect(put.mock.calls[0][0]).toBe('shared-bucket');
    expect(put.mock.calls[0][1]).toBe('fiam-staging/kyc/u1/FRONT/x.jpeg');
    expect(get).toHaveBeenCalledWith(
      'shared-bucket',
      'fiam-staging/kyc/u1/FRONT/x.jpeg',
    );
    expect(remove).toHaveBeenCalledWith(
      'shared-bucket',
      'fiam-staging/kyc/u1/FRONT/x.jpeg',
    );
  });

  it('with no prefix, keys are used as-is (local MinIO behaviour unchanged)', async () => {
    const svc = make({ keyPrefix: '' });
    await svc.upload('kyc/u1/a.jpeg', Buffer.from('x'), 'image/jpeg');
    expect(put.mock.calls[0][1]).toBe('kyc/u1/a.jpeg');
  });

  it('passes the region to the client and never tries to create the bucket when told not to', async () => {
    make();
    expect(
      (Minio.Client as unknown as jest.Mock).mock.calls[0][0],
    ).toMatchObject({
      region: 'fsn1',
      endPoint: 'fsn1.your-objectstorage.com',
      useSSL: true,
    });
    const svc = make();
    await svc.upload('k', Buffer.from('x'), 'text/plain');
    const client = (Minio.Client as unknown as jest.Mock).mock.results.at(
      -1,
    )!.value;
    expect(client.makeBucket).not.toHaveBeenCalled();
    expect(client.bucketExists).not.toHaveBeenCalled();
  });
});
