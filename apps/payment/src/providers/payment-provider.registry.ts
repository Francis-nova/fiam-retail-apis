import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrencyCode } from '@app/common';
import { PaymentConfig } from '../config/configuration';
import { PaymentProviderKey } from '../wallets/entities/address.entity';
import { PaymentProvider } from './payment-provider.interface';
import { VfdPaymentProvider } from './vfd/vfd-payment.provider';

export const PAYMENT_PROVIDER_REGISTRY = Symbol('PAYMENT_PROVIDER_REGISTRY');

export interface PaymentProviderRegistry {
  getProviderForCurrency(currency: CurrencyCode): PaymentProvider;
  getProviderByKey(key: PaymentProviderKey): PaymentProvider;
}

// Config strings use the same lowercase convention as SMS_PROVIDER/
// KYC_PROVIDER (e.g. 'vfd'); mapped to the PaymentProviderKey enum here,
// mirroring the switch-case in SmsModule/KycModule's factory providers.
function resolveProviderKey(raw: string): PaymentProviderKey {
  switch (raw) {
    case 'vfd':
      return PaymentProviderKey.VFD;
    default:
      throw new Error(`Unknown payment provider "${raw}"`);
  }
}

// SMS/KYC each resolve to one single global provider (see SmsModule/
// KycModule). Payments need simultaneous resolution per currency instead —
// NGN -> VFD today, USD/GBP -> whatever provider launches with them later —
// so this is a stateful registry, not a one-shot factory provider. Adding a
// second provider (e.g. FCMB) is one new class + one map.set() line below.
@Injectable()
export class PaymentProviderRegistryService implements PaymentProviderRegistry {
  private readonly byKey = new Map<PaymentProviderKey, PaymentProvider>();
  private readonly byCurrency = new Map<CurrencyCode, PaymentProvider>();

  constructor(
    configService: ConfigService<PaymentConfig, true>,
    vfd: VfdPaymentProvider,
  ) {
    this.byKey.set(PaymentProviderKey.VFD, vfd);

    const providerByCurrency = configService.get(
      'payments.providerByCurrency',
      {
        infer: true,
      },
    );
    for (const [currency, raw] of Object.entries(providerByCurrency)) {
      const key = resolveProviderKey(raw);
      const provider = this.byKey.get(key);
      if (!provider) {
        throw new Error(
          `Unknown payment provider key "${key}" for currency "${currency}"`,
        );
      }
      this.byCurrency.set(currency as CurrencyCode, provider);
    }
  }

  getProviderForCurrency(currency: CurrencyCode): PaymentProvider {
    const provider = this.byCurrency.get(currency);
    if (!provider) {
      throw new ServiceUnavailableException(
        `No payment provider configured for currency ${currency}`,
      );
    }
    return provider;
  }

  getProviderByKey(key: PaymentProviderKey): PaymentProvider {
    const provider = this.byKey.get(key);
    if (!provider) {
      throw new ServiceUnavailableException(`Unknown payment provider ${key}`);
    }
    return provider;
  }
}
