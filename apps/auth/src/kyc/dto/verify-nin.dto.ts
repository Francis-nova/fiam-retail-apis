import { IsNumberString, IsString, Length, MinLength } from 'class-validator';

export class VerifyNinDto {
  @IsNumberString()
  @Length(11, 11)
  nin: string;

  // The QoreID liveness_nin sessionId minted by POST /kyc/nin/liveness-session
  // and completed via the WebView-hosted SDK — see
  // KycDocumentsService.verifyNin's doc comment.
  @IsString()
  @MinLength(1)
  sessionId: string;
}
