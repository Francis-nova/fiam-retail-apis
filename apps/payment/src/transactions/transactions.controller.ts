import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { Transaction, TransactionType } from './entities/transaction.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/current-user.decorator';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parseLimit(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_LIMIT;
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

export interface TransactionResponse {
  id: string;
  type: string;
  status: string;
  currency: string;
  amount: string;
  fee: string | null;
  balanceAfter: string | null;
  reference: string;
  provider: string;
  narration: string | null;
  // Who the money came from (CREDIT) or went to (DEBIT) — resolved from
  // the saved Beneficiary for payouts, or the webhook's originator fields
  // for payins. Null when there's nothing to show (e.g. an UNMATCHED
  // payin never reaches here at all, since it has no owning wallet).
  counterpartyName: string | null;
  counterpartyAccountNumber: string | null;
  counterpartyBankName: string | null;
  occurredAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

function toResponse(transaction: Transaction): TransactionResponse {
  let counterpartyName: string | null = null;
  let counterpartyAccountNumber: string | null = null;
  let counterpartyBankName: string | null = null;

  if (transaction.type === TransactionType.DEBIT) {
    counterpartyName = transaction.beneficiary?.accountName ?? null;
    counterpartyAccountNumber = transaction.beneficiary?.accountNumber ?? null;
    counterpartyBankName = transaction.beneficiary?.bankName ?? null;
  } else {
    // CREDIT — the originator fields VFD's inward-credit webhook sends,
    // spread verbatim into rawPayload by WebhooksService. Only a bank
    // *code*, not a name, is available for the originator, so
    // counterpartyBankName is deliberately left null here rather than
    // showing a raw code as if it were a name.
    const payload = transaction.rawPayload;
    const name = payload?.originator_account_name;
    const accountNumber = payload?.originator_account_number;
    counterpartyName = typeof name === 'string' ? name : null;
    counterpartyAccountNumber =
      typeof accountNumber === 'string' ? accountNumber : null;
  }

  return {
    id: transaction.id,
    type: transaction.type,
    status: transaction.status,
    currency: transaction.currency,
    amount: transaction.amount,
    fee: transaction.fee,
    balanceAfter: transaction.balanceAfter,
    reference: transaction.reference,
    provider: transaction.provider,
    narration: transaction.narration,
    counterpartyName,
    counterpartyAccountNumber,
    counterpartyBankName,
    occurredAt: transaction.occurredAt?.toISOString() ?? null,
    verifiedAt: transaction.verifiedAt?.toISOString() ?? null,
    createdAt: transaction.createdAt.toISOString(),
  };
}

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  // Mobile's Dashboard "Recent Transactions" section and a future full
  // history screen both read this — most-recent-first, capped at 100 per
  // request (no cursor pagination yet, not needed for "recent N" today).
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
  ): Promise<TransactionResponse[]> {
    const transactions = await this.transactionsService.findAllForUser(
      user.userId,
      parseLimit(limit),
    );
    return transactions.map(toResponse);
  }

  // Backs the mobile transaction-details screen.
  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<TransactionResponse> {
    const transaction = await this.transactionsService.findOneForUser(
      user.userId,
      id,
    );
    return toResponse(transaction);
  }
}
