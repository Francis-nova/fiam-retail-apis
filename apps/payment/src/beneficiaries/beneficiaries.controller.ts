import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { BeneficiariesService } from './beneficiaries.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/current-user.decorator';

@Controller('beneficiaries')
export class BeneficiariesController {
  constructor(private readonly beneficiariesService: BeneficiariesService) {}

  // Mobile's "pay someone" flow reads this to offer saved recipients
  // instead of making the user re-enter bank/account details every time.
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async list(@CurrentUser() user: AuthenticatedUser) {
    const recents = await this.beneficiariesService.findAllForUser(user.userId);
    return recents.map(({ beneficiary, transferCount, lastTransferAt }) => ({
      id: beneficiary.id,
      bankCode: beneficiary.bankCode,
      bankName: beneficiary.bankName,
      accountNumber: beneficiary.accountNumber,
      accountName: beneficiary.accountName,
      transferCount,
      lastTransferAt: lastTransferAt.toISOString(),
    }));
  }
}
