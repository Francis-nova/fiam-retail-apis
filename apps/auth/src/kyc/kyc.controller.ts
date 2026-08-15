import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth } from '@nestjs/swagger';
import { KycDocumentsService } from './kyc-documents.service';
import { UploadKycDocumentDto } from './dto/upload-kyc-document.dto';
import { JwtAuthGuard } from '../tokens/jwt-auth.guard';
import { CurrentUser } from '../tokens/current-user.decorator';
import type { AuthenticatedUser } from '../tokens/current-user.decorator';
import { TIER_LIMITS } from '../users/tier-limits';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'application/pdf',
];
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;

@Controller('kyc')
export class KycController {
  constructor(private readonly kycDocumentsService: KycDocumentsService) {}

  @Get('tier-limits')
  tierLimits() {
    return TIER_LIMITS;
  }

  @Post('documents')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_FILE_SIZE_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
          callback(new BadRequestException('Unsupported file type'), false);
          return;
        }
        callback(null, true);
      },
    }),
  )
  uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadKycDocumentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.kycDocumentsService.upload(user.userId, dto.docType, file);
  }

  @Get('documents')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  listDocuments(@CurrentUser() user: AuthenticatedUser) {
    return this.kycDocumentsService.list(user.userId);
  }

  @Post('tier-upgrade/submit')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  submitTierUpgrade(@CurrentUser() user: AuthenticatedUser) {
    return this.kycDocumentsService.submitTierUpgrade(user.userId);
  }

  @Get('tier-upgrade/status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  tierUpgradeStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.kycDocumentsService.getTierUpgradeStatus(user.userId);
  }
}
