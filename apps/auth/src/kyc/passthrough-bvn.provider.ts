import { Injectable, Logger } from '@nestjs/common';
import {
  BvnApplicant,
  BvnProvider,
  BvnVerificationResult,
} from './bvn-provider.interface';

// Staging-only: skips the identity lookup and trusts whatever the customer
// submitted, so VFD's test BVNs can be used to provision accounts without
// QoreID needing to know them. Enabled solely via KYC_PROVIDER=passthrough;
// production must keep KYC_PROVIDER=qoreid.
@Injectable()
export class PassthroughBvnProvider implements BvnProvider {
  private readonly logger = new Logger(PassthroughBvnProvider.name);

  verify(bvn: string, applicant: BvnApplicant): Promise<BvnVerificationResult> {
    this.logger.warn(
      `KYC_PROVIDER=passthrough: skipping BVN lookup for [REDACTED]`,
    );
    return Promise.resolve({
      matched: true,
      firstName: applicant.firstName,
      lastName: applicant.lastName,
      phone: null,
      // null skips the DOB cross-check in AuthService.submitBvn
      dob: null,
      gender: null,
    });
  }
}
