import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { BillsService } from './bills.service';
import { BillBeneficiariesService } from './bill-beneficiaries.service';
import { BillType } from '../transactions/entities/transaction.entity';
import type { BillBeneficiary } from './entities/bill-beneficiary.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/current-user.decorator';
import {
  BillerRefDto,
  PayBillDto,
  RenameBillBeneficiaryDto,
  ValidateCustomerDto,
} from './dto/bills.dto';

function toBeneficiaryResponse(b: BillBeneficiary) {
  return {
    id: b.id,
    billType: b.billType,
    billerId: b.billerId,
    billerName: b.billerName,
    division: b.division,
    productId: b.productId,
    customerId: b.customerId,
    nickname: b.nickname,
    lastPaymentItem: b.lastPaymentItem,
    lastPaymentItemName: b.lastPaymentItemName,
    lastAmount: b.lastAmount,
    payCount: b.payCount,
    lastPaidAt: b.lastPaidAt.toISOString(),
  };
}

@Controller('bills')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BillsController {
  constructor(
    private readonly billsService: BillsService,
    private readonly beneficiaries: BillBeneficiariesService,
  ) {}

  @Get('categories')
  categories() {
    return this.billsService.listCategories();
  }

  @Get('billers')
  billers(@Query('category') category?: string) {
    return this.billsService.listBillers(category);
  }

  // Query-string ids, same names the biller list hands out.
  @Get('items')
  items(@Query() ref: BillerRefDto) {
    return this.billsService.listItems(ref);
  }

  // Meter / smartcard check before the customer commits.
  @Post('validate')
  validate(@Body() dto: ValidateCustomerDto) {
    return this.billsService.validateCustomer(dto);
  }

  @Post('pay')
  pay(@CurrentUser() user: AuthenticatedUser, @Body() dto: PayBillDto) {
    return this.billsService.payBill(user.userId, dto);
  }

  // Saved (nicknamed) first, then recents. ?billType=AIRTIME|DATA|… narrows it
  // to one tab of the bills form.
  @Get('beneficiaries')
  async listBeneficiaries(
    @CurrentUser() user: AuthenticatedUser,
    @Query('billType') billType?: string,
  ) {
    const type = (Object.values(BillType) as string[]).includes(billType ?? '')
      ? (billType as BillType)
      : undefined;
    const list = await this.beneficiaries.list(user.userId, type);
    return list.map(toBeneficiaryResponse);
  }

  @Patch('beneficiaries/:id')
  async renameBeneficiary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameBillBeneficiaryDto,
  ) {
    return toBeneficiaryResponse(
      await this.beneficiaries.rename(user.userId, id, dto.nickname),
    );
  }

  @Delete('beneficiaries/:id')
  @HttpCode(204)
  async removeBeneficiary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.beneficiaries.dismiss(user.userId, id);
  }
}
