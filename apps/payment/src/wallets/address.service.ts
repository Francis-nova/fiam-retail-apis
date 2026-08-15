import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CurrencyCode } from '@app/common';
import { PAYMENT_PROVIDER_REGISTRY } from '../providers/payment-provider.registry';
import type { PaymentProviderRegistry } from '../providers/payment-provider.registry';
import type {
  ProviderAccount,
  ProviderAccountApplicant,
} from '../providers/payment-provider.interface';
import { WalletsService } from './wallets.service';
import {
  Address,
  AddressStatus,
  PaymentProviderKey,
} from './entities/address.entity';

@Injectable()
export class AddressService {
  constructor(
    @InjectRepository(Address)
    private readonly addressRepo: Repository<Address>,
    private readonly walletsService: WalletsService,
    private readonly dataSource: DataSource,
    @Inject(PAYMENT_PROVIDER_REGISTRY)
    private readonly registry: PaymentProviderRegistry,
  ) {}

  findActiveByProviderAccountNumber(
    provider: PaymentProviderKey,
    accountNumber: string,
  ): Promise<Address | null> {
    return this.addressRepo.findOne({
      where: {
        provider,
        providerAccountNumber: accountNumber,
        status: AddressStatus.ACTIVE,
      },
    });
  }

  findActiveForWallet(walletId: string): Promise<Address | null> {
    return this.addressRepo.findOne({
      where: { walletId, status: AddressStatus.ACTIVE },
    });
  }

  // Consumed by the RabbitMQ provisioning handler. Idempotent two ways: (1)
  // an existing ACTIVE address short-circuits before any provider call, (2)
  // even a fresh provider.createAccount() call is itself idempotent for VFD
  // (its "01 Client Account Exists" response is treated as success), so
  // redelivery after a crash between the provider call and the DB insert is
  // still safe.
  async provisionAddress(
    userId: string,
    currency: CurrencyCode,
    applicant: ProviderAccountApplicant,
  ): Promise<Address> {
    const wallet = await this.walletsService.getOrCreateWallet(
      userId,
      currency,
    );
    const existing = await this.addressRepo.findOne({
      where: { walletId: wallet.id, status: AddressStatus.ACTIVE },
    });
    if (existing) {
      return existing;
    }

    const provider = this.registry.getProviderForCurrency(currency);
    const account = await provider.createAccount(applicant); // network call, outside any DB transaction
    return this.insertActiveAddress(wallet.id, account);
  }

  // Deactivates the wallet's current address and activates a new one from a
  // different provider. Not exposed over HTTP in v1 — there's no admin-auth
  // layer in this codebase yet, so this is meant to be invoked from a one-
  // off ts-node script, the same way migrations are run. A rare, deliberate,
  // high-stakes operational action; see the plan doc for the reasoning.
  async switchProvider(
    walletId: string,
    newProviderKey: PaymentProviderKey,
    applicant: ProviderAccountApplicant,
  ): Promise<Address> {
    const newProvider = this.registry.getProviderByKey(newProviderKey);
    const account = await newProvider.createAccount(applicant); // network call first, outside any DB transaction

    return this.dataSource.transaction(async (manager) => {
      await manager.update(
        Address,
        { walletId, status: AddressStatus.ACTIVE },
        { status: AddressStatus.INACTIVE, deactivatedAt: new Date() },
      );
      return this.insertActiveAddress(walletId, account, manager);
    });
  }

  private async insertActiveAddress(
    walletId: string,
    account: ProviderAccount,
    manager?: EntityManager,
  ): Promise<Address> {
    const repo = manager ? manager.getRepository(Address) : this.addressRepo;
    try {
      return await repo.save(
        repo.create({
          walletId,
          provider: account.provider,
          providerAccountNumber: account.accountNumber,
          providerAccountName: account.accountName,
          providerTierRaw: account.providerTierRaw,
          providerMetadata: account.metadata,
          status: AddressStatus.ACTIVE,
          activatedAt: new Date(),
        }),
      );
    } catch {
      // Lost a race with a concurrent insert (either the partial-unique
      // "one ACTIVE address per wallet" index, or the global provider+
      // accountNumber uniqueness) — the other insert won, read it back.
      const winner = await repo.findOne({
        where: { walletId, status: AddressStatus.ACTIVE },
      });
      if (!winner) {
        throw new Error(
          `Address insert conflict for wallet ${walletId} but no ACTIVE row found afterward`,
        );
      }
      return winner;
    }
  }
}
