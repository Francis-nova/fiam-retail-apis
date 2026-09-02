import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth } from '@nestjs/swagger';
import { KycDocumentsService } from './kyc-documents.service';
import { UploadKycDocumentDto } from './dto/upload-kyc-document.dto';
import { VerifyNinDto } from './dto/verify-nin.dto';
import { JwtAuthGuard } from '../tokens/jwt-auth.guard';
import { CurrentUser } from '../tokens/current-user.decorator';
import type { AuthenticatedUser } from '../tokens/current-user.decorator';
import { TIER_LIMITS } from '../users/tier-limits';
import { KYC_IMAGE_MIME_TYPES, KYC_MAX_FILE_SIZE_BYTES } from './kyc.constants';
import { NIN_LIVENESS_WIDGET_HTML } from './nin-liveness-widget.html';

const ALLOWED_MIME_TYPES = [...KYC_IMAGE_MIME_TYPES, 'application/pdf'];

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
      limits: { fileSize: KYC_MAX_FILE_SIZE_BYTES },
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
    return this.kycDocumentsService.upload(
      user.userId,
      dto.docType,
      file,
      dto.idType,
    );
  }

  @Get('documents')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  listDocuments(@CurrentUser() user: AuthenticatedUser) {
    return this.kycDocumentsService.list(user.userId);
  }

  // Mints the QoreID `liveness_nin` SDK session the mobile app loads into a
  // WebView (see NIN_LIVENESS_WIDGET_HTML) — this is the real,
  // account-entitled QoreID liveness product, not the custom camera flow it
  // replaces.
  @Post('nin/liveness-session')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  createNinLivenessSession(@CurrentUser() user: AuthenticatedUser) {
    return this.kycDocumentsService.createNinLivenessSession(user.userId);
  }

  // Served to a WebView, not fetched as JSON — no JwtAuthGuard, since a
  // WebView navigation can't attach an Authorization header. Safe to leave
  // open: it's a static page (see the file's own doc comment) that only
  // acts on whatever short-lived, single-use, QoreID-issued sdkSessionToken
  // is passed in the query string, and grants no access to anything of
  // ours.
  @Get('nin/liveness-widget')
  ninLivenessWidget(@Res() res: Response) {
    res.type('html').send(NIN_LIVENESS_WIDGET_HTML);
  }

  // Called once the WebView reports the QoreID SDK's own success event for
  // a session minted by nin/liveness-session above — see
  // KycDocumentsService.verifyNin's doc comment for the full trust model.
  @Post('nin/verify')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  verifyNin(@Body() dto: VerifyNinDto, @CurrentUser() user: AuthenticatedUser) {
    return this.kycDocumentsService.verifyNin(
      user.userId,
      dto.nin,
      dto.sessionId,
    );
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
