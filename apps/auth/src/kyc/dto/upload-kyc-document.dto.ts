import { IsEnum } from 'class-validator';
import { KycDocumentType } from '../entities/kyc-document.entity';

export class UploadKycDocumentDto {
  @IsEnum(KycDocumentType)
  docType: KycDocumentType;
}
