import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostofficeConfig } from '../config/configuration';
import { SMS_PROVIDER } from './sms-provider.interface';
import { TermiiSmsProvider } from './termii-sms.provider';

// Provider is selected by SMS_PROVIDER at runtime so swapping vendors later
// (Africa's Talking, Twilio, ...) is a new class + one line here, with the
// rest of the app depending only on the SmsProvider interface.
@Module({
  providers: [
    TermiiSmsProvider,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService, TermiiSmsProvider],
      useFactory: (
        configService: ConfigService<PostofficeConfig, true>,
        termii: TermiiSmsProvider,
      ) => {
        const provider = configService.get('sms.provider', { infer: true });
        switch (provider) {
          case 'termii':
            return termii;
          default:
            throw new Error(`Unknown SMS_PROVIDER: ${provider}`);
        }
      },
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
