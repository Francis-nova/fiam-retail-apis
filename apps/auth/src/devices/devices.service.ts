import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TrustedDevice } from './entities/trusted-device.entity';

export interface BiometricPreferences {
  loginEnabled?: boolean;
  transactionEnabled?: boolean;
}

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(TrustedDevice)
    private readonly trustedDevicesRepo: Repository<TrustedDevice>,
  ) {}

  async isTrusted(userId: string, deviceId?: string): Promise<boolean> {
    if (!deviceId) return false;
    const existing = await this.trustedDevicesRepo.findOne({
      where: { userId, deviceId },
    });
    return !!existing;
  }

  async trust(
    userId: string,
    deviceId: string,
    deviceName?: string | null,
  ): Promise<void> {
    const existing = await this.trustedDevicesRepo.findOne({
      where: { userId, deviceId },
    });
    if (existing) {
      await this.trustedDevicesRepo.update(existing.id, {
        lastSeenAt: new Date(),
        deviceName: deviceName ?? existing.deviceName,
      });
      return;
    }
    await this.trustedDevicesRepo.save(
      this.trustedDevicesRepo.create({
        userId,
        deviceId,
        deviceName: deviceName ?? null,
        trustedAt: new Date(),
        lastSeenAt: new Date(),
      }),
    );
  }

  listForUser(userId: string): Promise<TrustedDevice[]> {
    return this.trustedDevicesRepo.find({
      where: { userId },
      order: { lastSeenAt: 'DESC' },
    });
  }

  findTrustedDevice(
    userId: string,
    deviceId: string,
  ): Promise<TrustedDevice | null> {
    return this.trustedDevicesRepo.findOne({ where: { userId, deviceId } });
  }

  async setBiometricPreferences(
    userId: string,
    deviceId: string,
    prefs: BiometricPreferences,
  ): Promise<TrustedDevice> {
    const device = await this.trustedDevicesRepo.findOne({
      where: { userId, deviceId },
    });
    if (!device) {
      throw new NotFoundException(
        'This device is not yet trusted — sign in again before changing biometric settings',
      );
    }
    await this.trustedDevicesRepo.update(device.id, {
      ...(prefs.loginEnabled !== undefined && {
        biometricLoginEnabled: prefs.loginEnabled,
      }),
      ...(prefs.transactionEnabled !== undefined && {
        biometricTransactionEnabled: prefs.transactionEnabled,
      }),
    });
    return (await this.trustedDevicesRepo.findOneBy({ id: device.id }))!;
  }
}
