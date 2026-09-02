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
}

type SubjectResolver = string | ((data: Record<string, string>) => string);

const EMAIL_SUBJECTS: Record<EmailTemplate, SubjectResolver> = {
  [EmailTemplate.VERIFICATION_CODE]: 'Your Fiam verification code',
  [EmailTemplate.WELCOME]: 'Welcome to Fiam',
  [EmailTemplate.PASSWORD_CHANGED]: 'Your password was changed',
  [EmailTemplate.NEW_DEVICE_LOGIN]: 'New sign-in to your Fiam account',
  [EmailTemplate.WALLET_FUNDED]: 'Your wallet has been funded',
  [EmailTemplate.TRANSACTION_RECEIPT]: (data) =>
    data.direction === 'credit' ? 'Money received' : 'Money sent',
  [EmailTemplate.KYC_TIER_APPROVED]: (data) =>
    `You're now Tier ${data.tier} on Fiam`,
  [EmailTemplate.KYC_TIER_REJECTED]: 'Update needed on your verification',
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
