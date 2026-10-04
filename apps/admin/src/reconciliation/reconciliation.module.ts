import { Module } from '@nestjs/common';
import { InternalHttpModule } from '../common/internal-http.module';
import { ReconciliationController } from './reconciliation.controller';

@Module({
  imports: [InternalHttpModule],
  controllers: [ReconciliationController],
})
export class ReconciliationModule {}
