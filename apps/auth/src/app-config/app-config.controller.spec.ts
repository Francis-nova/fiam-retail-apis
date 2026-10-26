import { AppConfigController } from './app-config.controller';

describe('AppConfigController', () => {
  it('returns the Android version requirement from config', () => {
    const android = {
      minVersionCode: 18,
      latestVersionCode: 19,
      storeUrl: 'https://play.google.com/store/apps/details?id=com.usefiam',
    };
    const config = { get: jest.fn().mockReturnValue(android) };
    const controller = new AppConfigController(config as never);

    expect(controller.get()).toEqual({ android });
    expect(config.get).toHaveBeenCalledWith('appVersion.android', {
      infer: true,
    });
  });
});
