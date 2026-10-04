import { isValidVfdAuthHeader } from './vfd-auth-header';

describe('isValidVfdAuthHeader', () => {
  const token = 'U3dhcm1Ub3ThanNlcnZpY2VOb3dNZXRhRGF0YQ==';

  it('accepts "vfd <token>"', () => {
    expect(isValidVfdAuthHeader(`vfd ${token}`, token)).toBe(true);
  });

  it('rejects a missing, wrong, unprefixed or array header', () => {
    expect(isValidVfdAuthHeader(undefined, token)).toBe(false);
    expect(isValidVfdAuthHeader('vfd nope', token)).toBe(false);
    expect(isValidVfdAuthHeader(token, token)).toBe(false);
    expect(isValidVfdAuthHeader([`vfd ${token}`], token)).toBe(false);
  });

  it('fails closed when no token is configured', () => {
    expect(isValidVfdAuthHeader('vfd ', '')).toBe(false);
  });
});
