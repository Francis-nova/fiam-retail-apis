import { IsEnum, IsOptional } from 'class-validator';
import {
  GovernmentIdType,
  KycDocumentType,
} from '../entities/kyc-document.entity';

export class UploadKycDocumentDto {
  @IsEnum(KycDocumentType)
  docType: KycDocumentType;

  // Required (checked in KycDocumentsService, a cross-field rule not worth a
  // custom decorator — same convention as InitiatePayoutDto's XOR check)
  // when docType is GOVERNMENT_ID_FRONT/BACK; ignored otherwise.
  @IsOptional()
  @IsEnum(GovernmentIdType)
  idType?: GovernmentIdType;
}
