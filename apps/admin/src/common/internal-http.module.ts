import { Module } from '@nestjs/common';
import { InternalHttp } from './internal-http.service';

@Module({ providers: [InternalHttp], exports: [InternalHttp] })
export class InternalHttpModule {}
