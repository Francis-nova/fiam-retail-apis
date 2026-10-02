import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from '../users/users.module';
import { KycDocument } from '../kyc/entities/kyc-document.entity';
import { StorageModule } from '../storage/storage.module';
import { MessagingModule } from '../messaging/messaging.module';
import { DeletionModule } from '../deletion/deletion.module';
import { InternalController } from './internal.controller';
import { InternalKeyGuard } from './internal-key.guard';
import { AccountAdminService } from './account-admin.service';
import { SessionsModule } from '../sessions/sessions.module';
import { TokensModule } from '../tokens/tokens.module';

@Module({
  imports: [
    UsersModule,
    SessionsModule,
    TokensModule,
    StorageModule,
    MessagingModule,
    DeletionModule,
    TypeOrmModule.forFeature([KycDocument]),
  ],
  controllers: [InternalController],
  providers: [InternalKeyGuard, AccountAdminService],
})
export class InternalModule {}
