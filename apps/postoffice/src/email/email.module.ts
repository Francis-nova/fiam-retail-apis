import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostofficeConfig } from '../config/configuration';
import { EMAIL_PROVIDER } from './email-provider.interface';
import { ZeptomailEmailProvider } from './zeptomail-email.provider';
import { TemplateRendererService } from './template-renderer.service';

// Provider is selected by EMAIL_PROVIDER at runtime, same pattern as
// SmsModule/SMS_PROVIDER — swapping vendors later (Postmark, SES, ...) is a
// new class + one line here.
@Module({
  providers: [
    ZeptomailEmailProvider,
    TemplateRendererService,
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService, ZeptomailEmailProvider],
      useFactory: (
        configService: ConfigService<PostofficeConfig, true>,
        zeptomail: ZeptomailEmailProvider,
      ) => {
        const provider = configService.get('email.provider', {
          infer: true,
        });
        switch (provider) {
          case 'zeptomail':
            return zeptomail;
          default:
            throw new Error(`Unknown EMAIL_PROVIDER: ${provider}`);
        }
      },
    },
  ],
  exports: [EMAIL_PROVIDER, TemplateRendererService],
})
export class EmailModule {}
