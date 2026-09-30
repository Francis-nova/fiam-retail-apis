import { Module } from '@nestjs/common';
import { PUSH_PROVIDER } from './push-provider.interface';
import { OneSignalPushProvider } from './onesignal-push.provider';

// Same shape as SmsModule: the rest of the app depends only on the
// PushProvider interface, so swapping vendors later is a new class + one
// line here.
@Module({
  providers: [
    OneSignalPushProvider,
    { provide: PUSH_PROVIDER, useExisting: OneSignalPushProvider },
  ],
  exports: [PUSH_PROVIDER],
})
export class PushModule {}
