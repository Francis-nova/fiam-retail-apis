export const BVN_PROVIDER = Symbol('BVN_PROVIDER');

export interface BvnApplicant {
  firstName: string;
  lastName: string;
}

export interface BvnVerificationResult {
  matched: boolean;
  firstName: string;
  lastName: string;
  phone: string | null;
  dob: string | null;
  gender: string | null;
}

export interface BvnProvider {
  verify(bvn: string, applicant: BvnApplicant): Promise<BvnVerificationResult>;
}
