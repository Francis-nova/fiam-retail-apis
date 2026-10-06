import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostofficeConfig } from '../config/configuration';
import { PushPayload, PushProvider } from './push-provider.interface';
import { safeJson } from '@app/common';

const ONESIGNAL_URL = 'https://api.onesignal.com/notifications';

interface OneSignalResponse {
  id?: string;
  errors?: unknown;
}

// OneSignal "create notification" API. The mobile app logs each device in
// under the customer's user id (OneSignal's "external_id" alias), so
// targeting a customer is just a matter of passing that id.
@Injectable()
export class OneSignalPushProvider implements PushProvider {
  private readonly logger = new Logger(OneSignalPushProvider.name);

  constructor(
    private readonly configService: ConfigService<PostofficeConfig, true>,
  ) {}

  async send(userId: string, payload: PushPayload): Promise<void> {
    const { appId, restApiKey } = this.configService.get('push.onesignal', {
      infer: true,
    });
    if (!appId || !restApiKey) {
      throw new ServiceUnavailableException(
        'Push delivery is not configured (missing ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY)',
      );
    }

    const response = await fetch(ONESIGNAL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Key ${restApiKey}`,
      },
      body: JSON.stringify({
        app_id: appId,
        target_channel: 'push',
        include_aliases: { external_id: [userId] },
        headings: { en: payload.title },
        contents: { en: payload.body },
        data: payload.data,
      }),
    });
    const body = (await response
      .json()
      .catch(() => null)) as OneSignalResponse | null;

    if (!response.ok) {
      throw new Error(
        `OneSignal push failed: ${response.status} ${safeJson(body)}`,
      );
    }
    // OneSignal answers 200 with no `id` and an `errors` entry when the user
    // has no subscribed device yet — nothing wrong, just nobody to notify.
    if (!body?.id) {
      this.logger.debug(
        `OneSignal push to ${userId} reached no device: ${safeJson(body?.errors)}`,
      );
    }
  }
}
