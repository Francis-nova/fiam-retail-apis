import { Controller, Get } from '@nestjs/common';

// Placeholder shell — real modules (consumers, mailer, sms, push) land when
// the payment/RabbitMQ integration work reaches this service.
@Controller('health')
export class AppController {
  @Get()
  check() {
    return { status: 'ok', service: 'postoffice' };
  }
}
