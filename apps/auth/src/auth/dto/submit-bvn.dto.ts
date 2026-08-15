import { IsDateString, Matches } from 'class-validator';

export class SubmitBvnDto {
  @Matches(/^\d{11}$/, { message: 'BVN must be exactly 11 digits' })
  bvn: string;

  // ISO 'YYYY-MM-DD' — customer-entered, cross-checked against the BVN
  // provider's own returned DOB (see AuthService.submitBvn) and, once
  // verified, this is the value used for VFD account provisioning.
  @IsDateString(
    { strict: true },
    { message: 'dateOfBirth must be a valid date (YYYY-MM-DD)' },
  )
  dateOfBirth: string;
}
