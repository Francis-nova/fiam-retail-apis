import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { WalletsService } from './wallets.service';
import { AddressService } from './address.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/current-user.decorator';

export interface WalletSummary {
  currency: string;
  balance: string;
  provider: string | null;
  accountNumber: string | null;
  accountName: string | null;
}

@Controller('wallets')
export class WalletsController {
  constructor(
    private readonly walletsService: WalletsService,
    private readonly addressService: AddressService,
  ) {}

  // Mobile's Dashboard reads this to show the real NGN balance/account
  // number in place of the old dummy data. A wallet with no ACTIVE address
  // yet (provisioning still in flight, or hasn't been triggered) comes back
  // with provider/accountNumber/accountName all null — the balance itself
  // is still meaningful (0) since Wallet rows are created eagerly, ahead of
  // the address (see AddressService.provisionAddress).
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async me(@CurrentUser() user: AuthenticatedUser): Promise<WalletSummary[]> {
    const wallets = await this.walletsService.findAllForUser(user.userId);
    return Promise.all(
      wallets.map(async (wallet) => {
        const address = await this.addressService.findActiveForWallet(
          wallet.id,
        );
        return {
          currency: wallet.currency,
          balance: wallet.balance,
          provider: address?.provider ?? null,
          accountNumber: address?.providerAccountNumber ?? null,
          accountName: address?.providerAccountName ?? null,
        };
      }),
    );
  }
}
