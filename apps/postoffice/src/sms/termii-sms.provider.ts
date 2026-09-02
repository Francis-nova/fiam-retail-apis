import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostofficeConfig } from '../config/configuration';
import { SmsProvider } from './sms-provider.interface';

interface TermiiSendResponse {
  code?: string;
  message?: string;
}

// Termii "send message" API — https://developers.termii.com/messaging-api
// Plain SMS transport only — no OTP generation/verification here, that
// stays wherever the message actually originates (e.g. apps/auth).
@Injectable()
export class TermiiSmsProvider implements SmsProvider {
  private readonly logger = new Logger(TermiiSmsProvider.name);

  constructor(
    private readonly configService: ConfigService<PostofficeConfig, true>,
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
        // "dnd" so transactional messages still reach MTN numbers with
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
