// Every email template postoffice knows how to render, and the subject
// line that goes with it. Callers (auth, payment, ...) only ever supply a
// template key + data — postoffice owns copy, layout and subject, so a
// wording change never requires touching the producer's code.
export enum EmailTemplate {
  VERIFICATION_CODE = 'verification-code',
  WELCOME = 'welcome',
  PASSWORD_CHANGED = 'password-changed',
  NEW_DEVICE_LOGIN = 'new-device-login',
  WALLET_FUNDED = 'wallet-funded',
  TRANSACTION_RECEIPT = 'transaction-receipt',
  KYC_TIER_APPROVED = 'kyc-tier-approved',
  KYC_TIER_REJECTED = 'kyc-tier-rejected',
  DELETION_REQUEST_RECEIVED = 'deletion-request-received',
  DELETION_REQUEST_REJECTED = 'deletion-request-rejected',
  ACCOUNT_CLOSED = 'account-closed',
}

type SubjectResolver = string | ((data: Record<string, string>) => string);

const EMAIL_SUBJECTS: Record<EmailTemplate, SubjectResolver> = {
  [EmailTemplate.VERIFICATION_CODE]: 'Your Fiam verification code',
  [EmailTemplate.WELCOME]: 'Welcome to Fiam',
  [EmailTemplate.PASSWORD_CHANGED]: 'Your password was changed',
  [EmailTemplate.NEW_DEVICE_LOGIN]: 'New sign-in to your Fiam account',
  [EmailTemplate.WALLET_FUNDED]: 'Your wallet has been funded',
  [EmailTemplate.TRANSACTION_RECEIPT]: (data) =>
    data.adjustment === 'true'
      ? data.direction === 'credit'
        ? 'Your account was credited'
        : 'Your account was debited'
      : data.direction === 'credit'
        ? 'Money received'
        : 'Money sent',
  [EmailTemplate.KYC_TIER_APPROVED]: (data) =>
    `You're now Tier ${data.tier} on Fiam`,
  [EmailTemplate.KYC_TIER_REJECTED]: 'Update needed on your verification',
  [EmailTemplate.DELETION_REQUEST_RECEIVED]:
    'We received your account deletion request',
  [EmailTemplate.DELETION_REQUEST_REJECTED]:
    "We couldn't delete your account yet",
  [EmailTemplate.ACCOUNT_CLOSED]: 'Your Fiam account has been closed',
};

export function isEmailTemplate(value: string): value is EmailTemplate {
  return Object.values<string>(EmailTemplate).includes(value);
}

export function subjectFor(
  template: EmailTemplate,
  data: Record<string, string>,
): string {
  const resolver = EMAIL_SUBJECTS[template];
  return typeof resolver === 'function' ? resolver(data) : resolver;
}
