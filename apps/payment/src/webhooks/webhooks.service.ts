import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { CurrencyCode } from '@app/common';
import { PaymentProviderKey } from '../wallets/entities/address.entity';
import { TransactionsService } from '../transactions/transactions.service';
import { PAYMENT_PROVIDER_REGISTRY } from '../providers/payment-provider.registry';
import type { PaymentProviderRegistry } from '../providers/payment-provider.registry';
import type { VfdTransactionStatusResponse } from '../providers/vfd/vfd.types';
import { WebhookEvent } from './entities/webhook-event.entity';
import { VfdInwardCreditWebhookDto } from './dto/vfd-inward-credit-webhook.dto';

// VFD's docs show `"amount": "1000"` with no explicit unit stated. Assumed
// naira here — CONFIRM against a real VFD sandbox inward transfer before
// relying on this beyond dev/test (see verification plan). Our own internal
// representation is naira decimal too now, so no unit conversion is needed,
// just parsing.
function parseAmount(rawAmount: string): Decimal {
  return new Decimal(rawAmount);
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @InjectRepository(WebhookEvent)
    private readonly webhookEventsRepo: Repository<WebhookEvent>,
    private readonly transactionsService: TransactionsService,
    @Inject(PAYMENT_PROVIDER_REGISTRY)
    private readonly registry: PaymentProviderRegistry,
  ) {}

  async handleVfdInwardCredit(dto: VfdInwardCreditWebhookDto): Promise<void> {
    // VFD doesn't sign webhook payloads (see WebhooksController's doc
    // comment), so a webhook is only a *claim*. Before crediting, TSQ the
    // webhook's reference against VFD (GET /transactions?reference=) and
    // check the authoritative record agrees on the transaction succeeding,
    // the destination account, the amount and the originating account.
    // Fails closed: if VFD can't confirm (unreachable, or still pending), we
    // throw so the webhook returns non-2xx and can be redelivered/retriggered
    // rather than crediting on an unverified payload.
    //
    // Every delivery is logged to webhook_events first (verified=false), and
    // flipped to verified=true / verified_at=now once the TSQ agrees.
    const event = await this.webhookEventsRepo.save(
      this.webhookEventsRepo.create({
        provider: PaymentProviderKey.VFD,
        eventType: 'inward-credit',
        reference: dto.reference,
        payload: { ...dto },
      }),
    );
    const noteFailure = (
      note: string,
      tsqPayload: Record<string, unknown> | null = null,
    ) =>
      this.webhookEventsRepo.update(event.id, {
        verificationNote: note,
        tsqPayload: tsqPayload as never,
      });

    const provider = this.registry.getProviderForCurrency(CurrencyCode.NGN);
    const requery = await provider.queryTransferStatus(dto.reference);

    if (requery.outcome === 'REQUERY') {
      await noteFailure(
        `TSQ inconclusive (status ${requery.providerStatusCode ?? 'unknown'})`,
        requery.rawPayload,
      );
      this.logger.warn(
        `Inward-credit TSQ for reference ${dto.reference} is inconclusive (status ${requery.providerStatusCode ?? 'unknown'}) — not crediting yet`,
      );
      throw new ServiceUnavailableException(
        'Could not verify transaction with VFD yet',
      );
    }
    if (requery.outcome === 'FAILED') {
      await noteFailure(
        `TSQ did not confirm the transaction (status ${requery.providerStatusCode ?? 'unknown'})`,
        requery.rawPayload,
      );
      this.logger.error(
        `Inward-credit TSQ for reference ${dto.reference} did not confirm the transaction (status ${requery.providerStatusCode ?? 'unknown'}) — skipping credit`,
      );
      return;
    }

    const tsq = (requery.rawPayload as VfdTransactionStatusResponse | null)
      ?.data;
    const claimed = parseAmount(dto.amount);
    const mismatches: string[] = [];
    if (!tsq?.amount || !parseAmount(tsq.amount).equals(claimed)) {
      mismatches.push(`amount (webhook ${dto.amount}, TSQ ${tsq?.amount})`);
    }
    if (!tsq?.accountNo || tsq.accountNo !== dto.account_number) {
      mismatches.push(
        `destination account (webhook ${dto.account_number}, TSQ ${tsq?.accountNo})`,
      );
    }
    if (
      dto.originator_account_number &&
      tsq?.fromAccountNo &&
      tsq.fromAccountNo !== dto.originator_account_number
    ) {
      mismatches.push(
        `source account (webhook ${dto.originator_account_number}, TSQ ${tsq.fromAccountNo})`,
      );
    }
    if (mismatches.length > 0) {
      await noteFailure(
        `Mismatch with TSQ: ${mismatches.join('; ')}`,
        requery.rawPayload,
      );
      this.logger.error(
        `Inward-credit webhook ${dto.reference} disagrees with VFD's TSQ on ${mismatches.join('; ')} — skipping credit, needs manual review`,
      );
      return;
    }

    // TSQ is authoritative — its amount is what we credit, and its
    // originator (when it returns one) overrides the webhook's stored copy.
    await this.webhookEventsRepo.update(event.id, {
      verified: true,
      verifiedAt: new Date(),
      tsqPayload: requery.rawPayload as never,
    });
    const amount = parseAmount(tsq!.amount!);
    const sessionId = tsq?.sessionId ?? dto.session_id ?? null;

    await this.transactionsService.recordPayin({
      provider: PaymentProviderKey.VFD,
      currency: CurrencyCode.NGN, // VFD is NGN-only — see PaymentProviderRegistryService
      accountNumber: dto.account_number,
      amount,
      reference: dto.reference,
      externalId: sessionId,
      narration: dto.originator_narration ?? null,
      occurredAt: dto.timestamp ? new Date(dto.timestamp) : null,
      rawPayload: {
        ...dto,
        ...(tsq?.fromAccountNo && {
          originator_account_number: tsq.fromAccountNo,
        }),
        tsq: tsq ?? null,
      },
    });
  }
}
