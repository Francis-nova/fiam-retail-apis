import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthConfig } from '../config/configuration';
import { BVN_PROVIDER } from './bvn-provider.interface';
import { NIN_PROVIDER } from './nin-provider.interface';
import { QoreIdBvnProvider } from './qoreid-bvn.provider';
import { PassthroughBvnProvider } from './passthrough-bvn.provider';
import { QoreIdNinProvider } from './qoreid-nin.provider';
import { QoreIdTokenService } from './qoreid-token.service';
import { QoreIdSessionService } from './qoreid-session.service';
import { OcrService } from './ocr.service';
import { KycDocument } from './entities/kyc-document.entity';
import { KycDocumentsService } from './kyc-documents.service';
import { KycController } from './kyc.controller';
import { QoreIdWebhookController } from './qoreid-webhook.controller';
import { StorageModule } from '../storage/storage.module';
import { UsersModule } from '../users/users.module';
import { TokensModule } from '../tokens/tokens.module';

// Provider is selected by KYC_PROVIDER at runtime, mirroring the pattern
// apps/postoffice's SmsModule uses for SMS_PROVIDER, so a future
// identity-vendor swap is a new pair of classes + two lines here.
@Module({
  imports: [
    TypeOrmModule.forFeature([KycDocument]),
    StorageModule,
    UsersModule,
    TokensModule,
  ],
  controllers: [KycController, QoreIdWebhookController],
  providers: [
    QoreIdTokenService,
    QoreIdSessionService,
    QoreIdBvnProvider,
    PassthroughBvnProvider,
    QoreIdNinProvider,
    OcrService,
    KycDocumentsService,
    {
      provide: BVN_PROVIDER,
      inject: [ConfigService, QoreIdBvnProvider, PassthroughBvnProvider],
      useFactory: (
        configService: ConfigService<AuthConfig, true>,
        qoreid: QoreIdBvnProvider,
        passthrough: PassthroughBvnProvider,
      ) => {
        const provider = configService.get('kyc.provider', { infer: true });
        switch (provider) {
          case 'qoreid':
            return qoreid;
          case 'passthrough':
            return passthrough;
          default:
            throw new Error(`Unknown KYC_PROVIDER: ${provider}`);
        }
      },
    },
    {
      provide: NIN_PROVIDER,
      inject: [ConfigService, QoreIdNinProvider],
      useFactory: (
        configService: ConfigService<AuthConfig, true>,
        qoreid: QoreIdNinProvider,
      ) => {
        const provider = configService.get('kyc.provider', { infer: true });
        switch (provider) {
          // 'passthrough' only stubs BVN; NIN keeps using QoreID.
          case 'qoreid':
          case 'passthrough':
            return qoreid;
          default:
            throw new Error(`Unknown KYC_PROVIDER: ${provider}`);
        }
      },
    },
  ],
  exports: [BVN_PROVIDER],
})
export class KycModule {}
