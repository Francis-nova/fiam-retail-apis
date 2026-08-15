import { Inject, Injectable, Logger } from '@nestjs/common';
import { CurrencyCode } from '@app/common';
import { PaymentProviderKey } from '../wallets/entities/address.entity';
import { TransactionsService } from '../transactions/transactions.service';
import { PAYMENT_PROVIDER_REGISTRY } from '../providers/payment-provider.registry';
import type { PaymentProviderRegistry } from '../providers/payment-provider.registry';
import { VfdInwardCreditWebhookDto } from './dto/vfd-inward-credit-webhook.dto';

// VFD's docs show `"amount": "1000"` with no explicit unit stated. Assumed
// naira (so *100 to kobo) here — CONFIRM against a real VFD sandbox inward
// transfer before relying on this beyond dev/test (see verification plan).
function parseAmountMinor(rawAmount: string): bigint {
  const naira = Number.parseFloat(rawAmount);
  return BigInt(Math.round(naira * 100));
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly transactionsService: TransactionsService,
    @Inject(PAYMENT_PROVIDER_REGISTRY)
    private readonly registry: PaymentProviderRegistry,
  ) {}

  async handleVfdInwardCredit(dto: VfdInwardCreditWebhookDto): Promise<void> {
    // VFD doesn't sign webhook payloads (see WebhooksController's doc
    // comment) — before trusting one, requery the transaction against
    // VFD's own /transactions (TSQ) endpoint using the webhook's reference,
    // and only skip crediting on a *confirmed* mismatch/failure. A requery
    // that itself errors (network hiccup, VFD unavailable) fails open —
    // the shared secret already gates this endpoint, and our own inability
    // to reach VFD shouldn't block a legitimate credit.
    let amountMinor = parseAmountMinor(dto.amount);
    try {
      const provider = this.registry.getProviderForCurrency(CurrencyCode.NGN);
      const requery = await provider.queryTransferStatus(dto.reference);
      if (
        requery.providerStatusCode === '108' ||
        requery.outcome === 'FAILED'
      ) {
        this.logger.error(
          `Requery for inward-credit webhook reference ${dto.reference} did not confirm the transaction (status ${requery.providerStatusCode ?? 'unknown'}) — skipping credit`,
        );
        return;
      }
      const requeriedAmount = (
        requery.rawPayload as { data?: { amount?: string } } | null
      )?.data?.amount;
      if (requeriedAmount) {
        // Prefer VFD's own authoritative figure over the webhook's claimed
        // amount when the requery succeeded and returned one.
        amountMinor = parseAmountMinor(requeriedAmount);
      }
    } catch (err) {
      this.logger.warn(
        `Inward-credit requery failed for reference ${dto.reference}, proceeding on webhook payload alone: ${(err as Error).message}`,
      );
    }

    await this.transactionsService.recordPayin({
      provider: PaymentProviderKey.VFD,
      currency: CurrencyCode.NGN, // VFD is NGN-only — see PaymentProviderRegistryService
      accountNumber: dto.account_number,
      amountMinor,
      reference: dto.reference,
      externalId: dto.session_id ?? null,
      narration: dto.originator_narration ?? null,
      occurredAt: dto.timestamp ? new Date(dto.timestamp) : null,
      rawPayload: { ...dto },
    });
  }
}
