import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { CurrencyCode } from '@app/common';
import { BanksService } from './banks.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('banks')
export class BanksController {
  constructor(private readonly banksService: BanksService) {}

  // NGN-only today (VFD is the sole NGN provider) — no currency param yet,
  // same scope boundary as the rest of the payment API.
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  list() {
    return this.banksService.listBanks(CurrencyCode.NGN);
  }
}
