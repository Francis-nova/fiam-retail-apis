export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');

export interface PushPayload {
  title: string;
  body: string;
  // Custom data delivered with the notification (e.g. which transaction to
  // open on tap). Values are strings — the provider's data channel is a
  // flat map.
  data?: Record<string, string>;
}

export interface PushProvider {
  // `userId` is the customer's own user id; devices are registered with the
  // provider under it, so no device token is ever needed here.
  send(userId: string, payload: PushPayload): Promise<void>;
}
