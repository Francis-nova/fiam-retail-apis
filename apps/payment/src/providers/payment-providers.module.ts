import { Module } from '@nestjs/common';
import { VfdPaymentProvider } from './vfd/vfd-payment.provider';
import {
  PAYMENT_PROVIDER_REGISTRY,
  PaymentProviderRegistryService,
} from './payment-provider.registry';

@Module({
  providers: [
    VfdPaymentProvider,
    PaymentProviderRegistryService,
    {
      provide: PAYMENT_PROVIDER_REGISTRY,
      useExisting: PaymentProviderRegistryService,
    },
  ],
  exports: [PAYMENT_PROVIDER_REGISTRY],
})
export class PaymentProvidersModule {}
