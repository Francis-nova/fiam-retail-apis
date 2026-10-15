import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { BillsService } from './bills.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthenticatedUser } from '../auth/current-user.decorator';
import { BillerRefDto, PayBillDto, ValidateCustomerDto } from './dto/bills.dto';

@Controller('bills')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

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
}
