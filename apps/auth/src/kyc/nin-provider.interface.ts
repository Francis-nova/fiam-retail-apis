export const NIN_PROVIDER = Symbol('NIN_PROVIDER');

export interface NinApplicant {
  firstName: string;
  lastName: string;
  // Optional cross-check hint — Tier 1 signup already captured this via
  // BVN verification, so it's available for most Tier 3 applicants.
  dob?: string | null;
}

export interface NinVerificationResult {
  matched: boolean;
  firstName: string;
  lastName: string;
  phone: string | null;
  gender: string | null;
}

export interface NinProvider {
  verify(nin: string, applicant: NinApplicant): Promise<NinVerificationResult>;
}
