import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SendMailClient } from 'zeptomail';
import { PostofficeConfig } from '../config/configuration';
import { EmailMessage, EmailProvider } from './email-provider.interface';

// ZeptoMail Node SDK — https://www.npmjs.com/package/zeptomail
// The SDK sends `token` through as the raw Authorization header value, so
// ZEPTOMAIL_TOKEN must be the full "Send Mail Token" string as copied from
// the dashboard (already prefixed "Zoho-enczapikey ..."), not just the key.
@Injectable()
export class ZeptomailEmailProvider implements EmailProvider {
  private readonly logger = new Logger(ZeptomailEmailProvider.name);

  constructor(
    private readonly configService: ConfigService<PostofficeConfig, true>,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const { fromAddress, fromName, zeptomail } = this.configService.get(
      'email',
      { infer: true },
    );

    if (!zeptomail.token) {
      throw new ServiceUnavailableException(
        'Email delivery is not configured (missing ZEPTOMAIL_TOKEN)',
      );
    }

    const client = new SendMailClient({
      url: zeptomail.baseUrl,
      token: zeptomail.token,
    });

    try {
      await client.sendMail({
        from: { address: fromAddress, name: fromName },
        to: [
          {
            email_address: {
              address: message.to,
              name: message.toName ?? message.to,
            },
          },
        ],
        subject: message.subject,
        htmlbody: message.html,
      });
    } catch (err) {
      this.logger.error(`ZeptoMail send failed: ${(err as Error).message}`);
      throw new ServiceUnavailableException('Failed to send email');
    }
  }
}
