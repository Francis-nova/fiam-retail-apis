import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommsController } from './comms.controller';
import { BROADCAST_QUEUE, CommsProcessor } from './comms.processor';
import { CommsService } from './comms.service';
import { Broadcast } from './entities/broadcast.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Broadcast]),
    BullModule.registerQueue({ name: BROADCAST_QUEUE }),
  ],
  controllers: [CommsController],
  providers: [CommsService, CommsProcessor],
})
export class CommsModule {}
