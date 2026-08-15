import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthConfig } from '../config/configuration';
import { SmsProvider } from './sms-provider.interface';

interface TermiiSendResponse {
  code?: string;
  message?: string;
}

// Termii "send message" API — https://developers.termii.com/messaging-api
// We generate and hash our own OTP codes (see OtpService) and only use
// Termii as a plain SMS transport, never its hosted OTP send/verify flow.
@Injectable()
export class TermiiSmsProvider implements SmsProvider {
  private readonly logger = new Logger(TermiiSmsProvider.name);

  constructor(
    private readonly configService: ConfigService<AuthConfig, true>,
  ) {}

  async send(to: string, message: string): Promise<void> {
    const { apiKey, senderId, baseUrl } = this.configService.get('sms.termii', {
      infer: true,
    });

    if (!apiKey || !senderId) {
      throw new ServiceUnavailableException(
        'SMS delivery is not configured (missing TERMII_API_KEY / TERMII_SENDER_ID)',
      );
    }

    const response = await fetch(`${baseUrl}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        to,
        from: senderId,
        sms: message,
        type: 'plain',
        // "dnd" so transactional OTP codes still reach MTN numbers with
        // Do-Not-Disturb active, unlike the "generic" promotional route.
        channel: 'dnd',
      }),
    });

    const body = (await response
      .json()
      .catch(() => null)) as TermiiSendResponse | null;

    if (!response.ok || body?.code !== 'ok') {
      this.logger.error(
        `Termii send failed: ${response.status} ${JSON.stringify(body)}`,
      );
      throw new ServiceUnavailableException('Failed to send SMS');
    }
  }
}
