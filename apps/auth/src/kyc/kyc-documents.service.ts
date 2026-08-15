import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { KycDocument, KycDocumentType } from './entities/kyc-document.entity';
import { StorageService } from '../storage/storage.service';
import { UsersService } from '../users/users.service';
import { TierUpgradeStatus } from '../users/entities/user.entity';

// The full Tier 3 requirement set — matches the 3-step upgrade flow in the
// mobile app (government ID has two sides, counted as one requirement each).
const REQUIRED_DOC_TYPES: KycDocumentType[] = [
  KycDocumentType.GOVERNMENT_ID_FRONT,
  KycDocumentType.GOVERNMENT_ID_BACK,
  KycDocumentType.NIN_SELFIE,
  KycDocumentType.PROOF_OF_ADDRESS,
];

@Injectable()
export class KycDocumentsService {
  constructor(
    @InjectRepository(KycDocument)
    private readonly docsRepo: Repository<KycDocument>,
    private readonly storageService: StorageService,
    private readonly usersService: UsersService,
  ) {}

  async upload(
    userId: string,
    docType: KycDocumentType,
    file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const objectKey = `kyc/${userId}/${docType}/${randomUUID()}-${file.originalname}`;
    await this.storageService.upload(objectKey, file.buffer, file.mimetype);

    const existing = await this.docsRepo.findOne({
      where: { userId, docType },
    });
    if (existing) {
      await this.storageService.remove(existing.objectKey);
      await this.docsRepo.update(existing.id, {
        objectKey,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedAt: new Date(),
      });
      return this.toSummary(
        (await this.docsRepo.findOneBy({ id: existing.id }))!,
      );
    }

    const saved = await this.docsRepo.save(
      this.docsRepo.create({
        userId,
        docType,
        objectKey,
        originalFilename: file.originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedAt: new Date(),
      }),
    );
    return this.toSummary(saved);
  }

  async list(userId: string) {
    const docs = await this.docsRepo.find({ where: { userId } });
    return docs.map((doc) => this.toSummary(doc));
  }

  async submitTierUpgrade(userId: string) {
    const docs = await this.docsRepo.find({ where: { userId } });
    const uploaded = new Set(docs.map((doc) => doc.docType));
    const missing = REQUIRED_DOC_TYPES.filter((type) => !uploaded.has(type));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing required documents: ${missing.join(', ')}`,
      );
    }

    await this.usersService.setTierUpgradeStatus(
      userId,
      TierUpgradeStatus.UNDER_REVIEW,
      new Date(),
    );
    return this.getTierUpgradeStatus(userId);
  }

  async getTierUpgradeStatus(userId: string) {
    const user = await this.usersService.findById(userId);
    return {
      tier: user.tier,
      status: user.tierUpgradeStatus,
      submittedAt: user.tierUpgradeSubmittedAt,
      requiredDocTypes: REQUIRED_DOC_TYPES,
    };
  }

  private toSummary(doc: KycDocument) {
    return { docType: doc.docType, uploadedAt: doc.uploadedAt };
  }
}
