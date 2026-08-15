import { IsString, MinLength } from 'class-validator';

// A read-only "name enquiry" — resolves and returns the recipient's account
// name so the client can show "Confirm transfer to <NAME>" before actually
// submitting a payout. Doesn't debit or save a beneficiary; that only
// happens on an actual POST /payouts.
export class ResolveRecipientDto {
  @IsString()
  @MinLength(1)
  bankCode: string;

  @IsString()
  @MinLength(1)
  accountNumber: string;
}
