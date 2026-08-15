import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { CurrencyCode } from '@app/common';
import { Wallet } from './entities/wallet.entity';

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet)
    private readonly walletsRepo: Repository<Wallet>,
  ) {}

  findById(id: string): Promise<Wallet | null> {
    return this.walletsRepo.findOne({ where: { id } });
  }

  findAllForUser(userId: string): Promise<Wallet[]> {
    return this.walletsRepo.find({ where: { userId } });
  }

  findByUserAndCurrency(
    userId: string,
    currency: CurrencyCode,
  ): Promise<Wallet | null> {
    return this.walletsRepo.findOne({ where: { userId, currency } });
  }

  async getOrCreateWallet(
    userId: string,
    currency: CurrencyCode,
  ): Promise<Wallet> {
    const existing = await this.walletsRepo.findOne({
      where: { userId, currency },
    });
    if (existing) {
      return existing;
    }
    try {
      return await this.walletsRepo.save(
        this.walletsRepo.create({ userId, currency, balanceMinor: '0' }),
      );
    } catch {
      // Lost a race with a concurrent create (UQ_wallets_user_currency) —
      // the other insert won, so just read what it created.
      const wallet = await this.walletsRepo.findOne({
        where: { userId, currency },
      });
      if (!wallet) throw new NotFoundException('Wallet not found');
      return wallet;
    }
  }

  // Must be called inside an active transaction on `manager` — locks the row
  // so concurrent credits/debits on the same wallet serialize instead of
  // racing on a read-modify-write of balanceMinor.
  async creditForUpdate(
    manager: EntityManager,
    walletId: string,
    amountMinor: bigint,
  ): Promise<Wallet> {
    const wallet = await manager
      .createQueryBuilder(Wallet, 'wallet')
      .setLock('pessimistic_write')
      .where('wallet.id = :walletId', { walletId })
      .getOne();
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    const newBalance = BigInt(wallet.balanceMinor) + amountMinor;
    await manager.update(Wallet, walletId, {
      balanceMinor: newBalance.toString(),
    });
    wallet.balanceMinor = newBalance.toString();
    return wallet;
  }

  // Must be called inside an active transaction on `manager`, same locking
  // discipline as creditForUpdate — this is what lets a payout's balance
  // hold and a concurrent payin's credit serialize correctly instead of
  // racing on balanceMinor. Throws if the wallet can't cover the debit;
  // callers must not have called the provider's transfer API yet at this
  // point (see PayoutsService.initiatePayout — the debit happens before the
  // network call, so a rejected debit never needs a provider-side reversal).
  async debitForUpdate(
    manager: EntityManager,
    walletId: string,
    amountMinor: bigint,
  ): Promise<Wallet> {
    const wallet = await manager
      .createQueryBuilder(Wallet, 'wallet')
      .setLock('pessimistic_write')
      .where('wallet.id = :walletId', { walletId })
      .getOne();
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    const currentBalance = BigInt(wallet.balanceMinor);
    if (currentBalance < amountMinor) {
      throw new BadRequestException('Insufficient balance');
    }
    const newBalance = currentBalance - amountMinor;
    await manager.update(Wallet, walletId, {
      balanceMinor: newBalance.toString(),
    });
    wallet.balanceMinor = newBalance.toString();
    return wallet;
  }
}
