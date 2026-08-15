import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { PayoutsService } from './payouts.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/current-user.decorator';
import { ResolveRecipientDto } from './dto/resolve-recipient.dto';
import { InitiatePayoutDto } from './dto/initiate-payout.dto';

@Controller('payouts')
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  // Name-enquiry preview — no debit, no beneficiary save. Lets the client
  // show "Confirm transfer to <NAME>" before the customer commits.
  @Post('recipient')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  resolveRecipient(@Body() dto: ResolveRecipientDto) {
    return this.payoutsService.resolveRecipient(dto);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  initiate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: InitiatePayoutDto,
  ) {
    return this.payoutsService.initiatePayout(user.userId, dto);
  }
}
