import { Controller, Get } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthConfig } from '../config/configuration';

// Public (no JWT): the app asks this before anyone is signed in, to learn
// whether the installed build is still allowed to run.
@Controller('app-config')
export class AppConfigController {
  constructor(private readonly config: ConfigService<AuthConfig, true>) {}

  @Get()
  get() {
    return {
      android: this.config.get('appVersion.android', { infer: true }),
    };
  }
}
