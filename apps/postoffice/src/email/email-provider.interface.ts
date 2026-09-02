export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

export interface EmailMessage {
  to: string;
  toName?: string;
  subject: string;
  html: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}
