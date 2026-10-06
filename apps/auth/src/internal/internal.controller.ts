import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiExcludeController } from '@nestjs/swagger';
import { UsersService } from '../users/users.service';
import { InternalKeyGuard } from './internal-key.guard';
import { AccountAdminService } from './account-admin.service';
import { AuthService } from '../auth/auth.service';
import { VerifyPinDto } from '../auth/dto/verify-pin.dto';
import { DeletionService } from '../deletion/deletion.service';
import { AccountActionDto, UpdateProfileDto } from './account-admin.dto';

// Consumed by other Fiam services (e.g. payment, to address a transaction
// email). Not part of the public API, so it's hidden from Swagger.
@ApiExcludeController()
@Controller('internal')
@UseGuards(InternalKeyGuard)
export class InternalController {
  constructor(
    private readonly usersService: UsersService,
    private readonly accountAdmin: AccountAdminService,
    private readonly deletion: DeletionService,
    private readonly authService: AuthService,
  ) {}

  @Get('users/:id/contact')
  async contact(@Param('id', new ParseUUIDPipe()) id: string) {
    const user = await this.usersService.findById(id);
    return { email: user.email, firstName: user.firstName };
  }

  // Called by payment from inside POST /payouts: the transaction PIN is
  // checked as part of the money movement itself, so a stolen access token
  // can't skip it by calling the payout endpoint directly. Shares the
  // per-account attempt limit with every other PIN check. 200 = correct;
  // 401 = wrong; 429 = locked. Body: { transferLimit } (null = unrestricted).
  @Post('users/:id/verify-pin')
  @HttpCode(200)
  async verifyPin(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: VerifyPinDto,
  ) {
    await this.authService.verifyTransactionPin(id, dto.pin);
    // The PIN is right — also tell payment about any outflow restriction so
    // it can enforce it in the same request (one round trip, no race).
    return { transferLimit: await this.authService.transferLimit(id) };
  }

  // Support: lets a customer back in after repeated wrong password/PIN tries.
  // The new-device transfer limit is a CBN rule and is deliberately NOT lifted.
  @Post('users/:id/clear-lockouts')
  @HttpCode(200)
  async clearLockouts(@Param('id', new ParseUUIDPipe()) id: string) {
    await this.usersService.findById(id);
    await this.usersService.clearLockouts(id);
    return { cleared: true };
  }

  // Current outflow restriction (new-device limit), for the transfer screen.
  @Get('users/:id/transfer-limit')
  async transferLimit(@Param('id', new ParseUUIDPipe()) id: string) {
    return { transferLimit: await this.authService.transferLimit(id) };
  }

  // --- Back-office (admin console) account actions ---

  @Post('users/:id/suspend')
  @HttpCode(200)
  suspend(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.accountAdmin.suspend(id);
  }

  @Post('users/:id/reactivate')
  @HttpCode(200)
  reactivate(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.accountAdmin.reactivate(id);
  }

  @Patch('users/:id/profile')
  updateProfile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.accountAdmin.updateProfile(id, dto);
  }

  @Post('users/:id/sessions/revoke')
  @HttpCode(200)
  revokeSessions(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.accountAdmin.revokeSessions(id);
  }

  @Delete('users/:id/sessions/:sessionId')
  revokeSession(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
  ) {
    return this.accountAdmin.revokeSession(id, sessionId);
  }

  @Post('users/:id/close')
  @HttpCode(200)
  close(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AccountActionDto,
  ) {
    return this.accountAdmin.close(id, dto.actorEmail);
  }

  @Post('deletion-requests/:id/reject')
  @HttpCode(200)
  rejectDeletion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AccountActionDto,
  ) {
    return this.deletion.reject(id, dto.reason ?? '', dto.actorEmail);
  }

  @Post('users/:id/tier-upgrade/approve')
  @HttpCode(200)
  approveTierUpgrade(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.accountAdmin.approveTierUpgrade(id);
  }

  @Post('users/:id/tier-upgrade/reject')
  @HttpCode(200)
  rejectTierUpgrade(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AccountActionDto,
  ) {
    return this.accountAdmin.rejectTierUpgrade(id, dto.reason ?? '');
  }

  // Streams a stored KYC document. nosniff + a no-store policy because these
  // are identity documents; only image/PDF types are ever rendered inline.
  @Get('users/:id/kyc-documents/:docId/file')
  async kycDocumentFile(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('docId', new ParseUUIDPipe()) docId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.accountAdmin.kycDocumentFile(id, docId);
    const inline = /^(image\/(jpeg|png|heic)|application\/pdf)$/.test(
      file.mimeType,
    );
    res.set({
      'Content-Type': inline ? file.mimeType : 'application/octet-stream',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(file.filename)}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    });
    return new StreamableFile(file.stream);
  }
}
