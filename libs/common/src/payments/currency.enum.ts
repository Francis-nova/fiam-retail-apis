// Currencies the platform can hold a wallet in. Only NGN is live today —
// new fiat/crypto values are additive here (plus an `ALTER TYPE ... ADD
// VALUE` migration in apps/payment) when those currencies actually launch.
export enum CurrencyCode {
  NGN = 'NGN',
}
