import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, MoreThan, Repository } from 'typeorm';
import { Otp, OtpPurpose } from './entities/otp.entity';
import { AuthConfig } from '../config/configuration';
import { generateOtpCode, hashOtpCode } from './otp.util';

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);

  constructor(
    @InjectRepository(Otp)
    private readonly otpRepo: Repository<Otp>,
    private readonly configService: ConfigService<AuthConfig, true>,
  ) {}

  async generate(userId: string, purpose: OtpPurpose): Promise<string> {
    const length = this.configService.get('otp.codeLength', { infer: true });
    const ttlSeconds = this.configService.get('otp.ttlSeconds', {
      infer: true,
    });
    const resendCooldownSeconds = this.configService.get(
      'otp.resendCooldownSeconds',
      { infer: true },
    );

    const recent = await this.otpRepo.findOne({
      where: {
        userId,
        purpose,
        createdAt: MoreThan(
          new Date(Date.now() - resendCooldownSeconds * 1000),
        ),
      },
      order: { createdAt: 'DESC' },
    });
    if (recent) {
      throw new HttpException(
        'Please wait before requesting another code',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const code = generateOtpCode(length);

    await this.otpRepo.save(
      this.otpRepo.create({
        userId,
        purpose,
        codeHash: hashOtpCode(code),
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      }),
    );

    // TODO: once the postoffice service + RabbitMQ exist, publish an
    // `auth.otp.requested` event instead of logging. Logging is a dev-only
    // stand-in so the registration/login flow is usable end-to-end today.
    this.logger.log(`OTP for user ${userId} (${purpose}): ${code}`);

    return code;
  }

  async verify(
    userId: string,
    purpose: OtpPurpose,
    code: string,
  ): Promise<boolean> {
    const maxAttempts = this.configService.get('otp.maxAttempts', {
      infer: true,
    });
    const otp = await this.otpRepo.findOne({
      where: { userId, purpose, consumedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });

    if (
      !otp ||
      otp.expiresAt.getTime() < Date.now() ||
      otp.attempts >= maxAttempts
    ) {
      return false;
    }

    if (hashOtpCode(code) !== otp.codeHash) {
      await this.otpRepo.update(otp.id, { attempts: otp.attempts + 1 });
      return false;
    }

    await this.otpRepo.update(otp.id, { consumedAt: new Date() });
    return true;
  }

  // Called when a just-generated code failed to actually reach the user
  // (SMS/provider send threw) — clears it so the resend cooldown doesn't
  // lock them out of retrying for a code they never received.
  async purgeUnconsumed(userId: string, purpose: OtpPurpose): Promise<void> {
    await this.otpRepo.delete({ userId, purpose, consumedAt: IsNull() });
  }
}
