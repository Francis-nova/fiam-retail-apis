import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthConfig } from '../config/configuration';
import { BVN_PROVIDER } from './bvn-provider.interface';
import { QoreIdBvnProvider } from './qoreid-bvn.provider';
import { KycDocument } from './entities/kyc-document.entity';
import { KycDocumentsService } from './kyc-documents.service';
import { KycController } from './kyc.controller';
import { StorageModule } from '../storage/storage.module';
import { UsersModule } from '../users/users.module';
import { TokensModule } from '../tokens/tokens.module';

// Provider is selected by KYC_PROVIDER at runtime, mirroring SmsModule, so a
// future BVN vendor swap is a new class + one line here.
@Module({
  imports: [
    TypeOrmModule.forFeature([KycDocument]),
    StorageModule,
    UsersModule,
    TokensModule,
  ],
  controllers: [KycController],
  providers: [
    QoreIdBvnProvider,
    KycDocumentsService,
    {
      provide: BVN_PROVIDER,
      inject: [ConfigService, QoreIdBvnProvider],
      useFactory: (
        configService: ConfigService<AuthConfig, true>,
        qoreid: QoreIdBvnProvider,
      ) => {
        const provider = configService.get('kyc.provider', { infer: true });
        switch (provider) {
          case 'qoreid':
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
