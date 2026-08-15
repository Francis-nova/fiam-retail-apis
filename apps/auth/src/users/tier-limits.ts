import { CustomerTier } from './entities/user.entity';

export interface TierLimit {
  tier: CustomerTier;
  label: string;
  // Naira. `null` means no limit (Tier 3 under the CBN framework).
  maxSingleDeposit: number | null;
  maxCumulativeBalance: number | null;
}

// CBN Tiered Know-Your-Customer (KYC) Requirements for banks/OFIs — the
// standard 3-tier limit table Nigerian fintechs build against. Tier 2 is not
// offered as an upgrade path in this app (see [[project_fiam_signup_flow]]),
// but its limits are kept here for completeness/reference.
export const TIER_LIMITS: Record<CustomerTier, TierLimit> = {
  [CustomerTier.TIER_1]: {
    tier: CustomerTier.TIER_1,
    label: 'Tier 1 · Basic',
    maxSingleDeposit: 50_000,
    maxCumulativeBalance: 300_000,
  },
  [CustomerTier.TIER_2]: {
    tier: CustomerTier.TIER_2,
    label: 'Tier 2 · Standard',
    maxSingleDeposit: 200_000,
    maxCumulativeBalance: 500_000,
  },
  [CustomerTier.TIER_3]: {
    tier: CustomerTier.TIER_3,
    label: 'Tier 3 · Premium',
    maxSingleDeposit: null,
    maxCumulativeBalance: null,
  },
};
