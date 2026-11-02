import { Module } from '@nestjs/common';
import { InternalHttpModule } from '../common/internal-http.module';
import { SettingsController } from './settings.controller';

@Module({
  imports: [InternalHttpModule],
  controllers: [SettingsController],
})
export class SettingsModule {}
