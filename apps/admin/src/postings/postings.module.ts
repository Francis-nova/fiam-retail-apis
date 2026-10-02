import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InternalHttpModule } from '../common/internal-http.module';
import { CustomersModule } from '../customers/customers.module';
import { Posting } from './entities/posting.entity';
import { PostingsController } from './postings.controller';
import { PostingsService } from './postings.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Posting]),
    CustomersModule,
    InternalHttpModule,
  ],
  controllers: [PostingsController],
  providers: [PostingsService],
})
export class PostingsModule {}
