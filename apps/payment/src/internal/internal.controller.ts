import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../transactions/entities/transaction.entity';
import { PaymentProviderKey } from '../wallets/entities/address.entity';
import { PayoutsService } from '../payouts/payouts.service';
import { InternalKeyGuard } from './internal-key.guard';
import { PostingsService } from './postings.service';
import { UnmatchedService } from './unmatched.service';
import { ReconciliationService } from './reconciliation.service';
import { CreatePostingDto } from './postings.dto';
import { AssignUnmatchedDto } from './unmatched.dto';

// Called by the admin console only; hidden from Swagger.
@ApiExcludeController()
@Controller('internal')
@UseGuards(InternalKeyGuard)
export class InternalController {
  constructor(
    private readonly postings: PostingsService,
    private readonly unmatched: UnmatchedService,
    private readonly reconciliation: ReconciliationService,
    private readonly payouts: PayoutsService,
    @InjectRepository(Transaction)
    private readonly transactions: Repository<Transaction>,
  ) {}

  @Post('postings')
  @HttpCode(200)
  post(@Body() dto: CreatePostingDto) {
    return this.postings.post(dto);
  }

  // Credits an UNMATCHED deposit to the wallet staff decided it belongs to.
  @Post('unmatched/:id/assign')
  @HttpCode(200)
  assign(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AssignUnmatchedDto,
  ) {
    return this.unmatched.assign(id, dto);
  }

  // Asks the provider where a stuck payout stands (same logic as the
  // background worker). Never guesses: an unanswered query changes nothing.
  @Post('transactions/:id/requery')
  @HttpCode(200)
  async requery(@Param('id', new ParseUUIDPipe()) id: string) {
    const txn = await this.transactions.findOneBy({ id });
    if (!txn) throw new NotFoundException('Transaction not found');
    if (
      txn.type !== TransactionType.DEBIT ||
      txn.provider === PaymentProviderKey.MANUAL
    ) {
      throw new BadRequestException('Only customer payouts can be re-queried');
    }
    if (
      txn.status !== TransactionStatus.PENDING &&
      txn.status !== TransactionStatus.PROCESSING
    ) {
      throw new ConflictException(
        `This payout is already ${txn.status.toLowerCase()}`,
      );
    }
    let outcome: string;
    try {
      outcome = await this.payouts.syncPayoutStatus(id);
    } catch {
      throw new ServiceUnavailableException(
        'The provider could not be reached. Nothing was changed; try again shortly.',
      );
    }
    const after = await this.transactions.findOneByOrFail({ id });
    return {
      outcome,
      status: after.status,
      providerStatusCode: after.providerStatusCode,
    };
  }

  @Get('reconciliation')
  reconcile() {
    return this.reconciliation.summary();
  }
}
