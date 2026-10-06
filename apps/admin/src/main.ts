import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';
import {
  HttpExceptionFilter,
  hardenHttp,
  swaggerEnabled,
  initErrorTracking,
} from '@app/common';
import { AdminConfig } from './config/configuration';
import { ipAllowlist, parseAllowedIps } from './common/ip-allowlist';

async function bootstrap() {
  initErrorTracking('admin');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  hardenHttp(app);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new HttpExceptionFilter());

  const config = app.get<ConfigService<AdminConfig, true>>(ConfigService);

  // Optional network restriction: only these IPs/CIDRs may reach the API.
  // Unset = not enforced. Registered first so nothing else runs for outsiders.
  const allowed = parseAllowedIps(process.env.ADMIN_ALLOWED_IPS);
  if (allowed) {
    app.use(ipAllowlist(allowed));
    new Logger('Bootstrap').log(
      `IP allowlist enforced (${allowed.length} entries)`,
    );
  }
  // Unlike the customer APIs this one is always called from a browser, so
  // CORS stays on in production — CORS_ORIGIN must then be the console's origin.
  app.enableCors({
    origin: config.get('corsOrigin', { infer: true }),
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    // The refresh-token cookie is sent cross-origin (console -> API), which
    // needs credentials AND an explicit origin (never '*').
    credentials: true,
  });

  if (swaggerEnabled(config.get('env', { infer: true }))) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Fiam Admin API')
        .setDescription('Back-office console API: staff, users, KYC, payments.')
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  const port = config.get('port', { infer: true });
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`Admin API running on port ${port}`);
}
void bootstrap();
