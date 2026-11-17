// Currencies the platform can hold a wallet in. New values are additive here
// (plus an `ALTER TYPE ... ADD VALUE` migration in apps/payment).
export enum CurrencyCode {
  NGN = 'NGN',
  // Stablecoins, held for the customer at StableStack (apps/payment/src/crypto).
  USDC = 'USDC',
  USDT = 'USDT',
}
