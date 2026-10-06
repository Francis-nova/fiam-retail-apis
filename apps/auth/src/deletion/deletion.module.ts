import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CredentialsModule } from '../credentials/credentials.module';
import { MessagingModule } from '../messaging/messaging.module';
import { TokensModule } from '../tokens/tokens.module';
import { UsersModule } from '../users/users.module';
import { DeletionController } from './deletion.controller';
import { DeletionService } from './deletion.service';
import { AccountDeletionRequest } from './entities/account-deletion-request.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([AccountDeletionRequest]),
    UsersModule,
    CredentialsModule,
    MessagingModule,
    TokensModule,
  ],
  controllers: [DeletionController],
  providers: [DeletionService],
  exports: [DeletionService],
})
export class DeletionModule {}
