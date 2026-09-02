import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  GovernmentIdType,
  KycDocument,
  KycDocumentType,
} from './entities/kyc-document.entity';
import { StorageService } from '../storage/storage.service';
import { UsersService } from '../users/users.service';
import { TierUpgradeStatus } from '../users/entities/user.entity';
import { OcrService } from './ocr.service';
import { NIN_PROVIDER } from './nin-provider.interface';
import type { NinProvider } from './nin-provider.interface';
import { QoreIdSessionService } from './qoreid-session.service';

// The product code confirmed live against this account's real credentials
// as the one actually subscribed — see QoreIdSessionService's doc comment.
const LIVENESS_NIN_PRODUCT_CODE = 'liveness_nin';

// How long a minted liveness session stays claimable by verifyNin — well
// above QoreID's own SDK-session TTL (their docs describe it as
// "short-lived (minutes)"), just long enough to cover a slow customer
// without leaving stale entries around indefinitely.
const LIVENESS_SESSION_TTL_MS = 15 * 60 * 1000;

interface PendingLivenessSession {
  userId: string;
  createdAt: number;
}

// The full Tier 3 requirement set — matches the 3-step upgrade flow in the
// mobile app (government ID has two sides, counted as one requirement each).
// NIN verification (a QoreID call, not a file) is checked separately via
// user.ninVerifiedAt — see submitTierUpgrade/getTierUpgradeStatus. No
// NIN_SELFIE requirement here: the liveness photo now lives entirely inside
// QoreID's own `liveness_nin` SDK flow (see verifyNin's doc comment) — we
// never receive or store the raw biometric image ourselves.
const REQUIRED_DOC_TYPES: KycDocumentType[] = [
  KycDocumentType.GOVERNMENT_ID_FRONT,
  KycDocumentType.GOVERNMENT_ID_BACK,
  KycDocumentType.PROOF_OF_ADDRESS,
];

const GOVERNMENT_ID_DOC_TYPES = new Set<KycDocumentType>([
  KycDocumentType.GOVERNMENT_ID_FRONT,
  KycDocumentType.GOVERNMENT_ID_BACK,
]);

@Injectable()
export class KycDocumentsService {
  // In-memory, single-instance store of sessions we've actually minted —
  // verifyNin only accepts a sessionId that appears here (and belongs to
  // the calling user), so a client can't just fabricate an arbitrary
  // sessionId to skip the QoreID SDK flow entirely. Consumed (deleted) on
  // use. A multi-instance deployment would need this in Redis instead; not
  // needed at this app's current scale (single dev instance).
  private readonly pendingLivenessSessions = new Map<
    string,
    PendingLivenessSession
  >();

  constructor(
    @InjectRepository(KycDocument)
    private readonly docsRepo: Repository<KycDocument>,
    private readonly storageService: StorageService,
    private readonly usersService: UsersService,
    private readonly ocrService: OcrService,
    @Inject(NIN_PROVIDER) private readonly ninProvider: NinProvider,
    private readonly qoreIdSessionService: QoreIdSessionService,
  ) {}

  async upload(
    userId: string,
    docType: KycDocumentType,
    file: Express.Multer.File,
    idType?: GovernmentIdType,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    if (GOVERNMENT_ID_DOC_TYPES.has(docType) && !idType) {
      throw new BadRequestException(
        'idType is required for a government ID upload',
      );
    }

    const objectKey = `kyc/${userId}/${docType}/${randomUUID()}-${file.originalname}`;
    await this.storageService.upload(objectKey, file.buffer, file.mimetype);

    // Best-effort — never blocks the upload itself (see OcrService's own
    // doc comment). Only runs for the document types a reviewer actually
    // wants extracted text for.
    const ocrText = GOVERNMENT_ID_DOC_TYPES.has(docType)
      ? await this.ocrService.extractText(file.buffer, file.mimetype)
      : null;

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
        idType: idType ?? existing.idType,
        ocrText,
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
        idType: idType ?? null,
        ocrText,
      }),
    );
    return this.toSummary(saved);
  }

  async list(userId: string) {
    const docs = await this.docsRepo.find({ where: { userId } });
    return docs.map((doc) => this.toSummary(doc));
  }

  private pruneExpiredLivenessSessions(): void {
    const cutoff = Date.now() - LIVENESS_SESSION_TTL_MS;
    for (const [sessionId, session] of this.pendingLivenessSessions) {
      if (session.createdAt < cutoff)
        this.pendingLivenessSessions.delete(sessionId);
    }
  }

  // Mints a QoreID `liveness_nin` SDK session — see NIN_LIVENESS_WIDGET_HTML's
  // doc comment for why this is a WebView-hosted QoreID Web SDK flow rather
  // than a plain REST call. The mobile app loads the returned
  // sdkSessionToken into `GET /kyc/nin/liveness-widget` inside a WebView;
  // QoreID's own SDK runs the actual camera-based liveness challenge and
  // face-match entirely on their infrastructure.
  async createNinLivenessSession(userId: string) {
    this.pruneExpiredLivenessSessions();
    const user = await this.usersService.findById(userId);
    const reference = `nin-liveness-${userId}-${Date.now()}`;
    const session = await this.qoreIdSessionService.createSession(
      LIVENESS_NIN_PRODUCT_CODE,
      reference,
    );
    this.pendingLivenessSessions.set(session.sessionId, {
      userId,
      createdAt: Date.now(),
    });
    return {
      sessionId: session.sessionId,
      sdkSessionToken: session.sdkSessionToken,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }

  // Called once the mobile app's WebView reports the QoreID SDK's own
  // 'success' event for a session created by createNinLivenessSession above
  // — that event is QoreID's own liveness+face-match product confirming a
  // real, live person completed their challenge, which is not something
  // obtainable any other way on this account (the plain REST
  // face-verification product isn't one this account is subscribed to;
  // confirmed live, see QoreIdSessionService). This method adds a second,
  // independently-verifiable factor on top of trusting that client report:
  // a fresh, authoritative REST name-match against QoreID's NIN registry
  // (same call submitBvn makes for BVN, minus the OTP hop). Both must hold.
  //
  // `sessionId` must be one this service actually minted for this user
  // (via the in-memory pendingLivenessSessions map) and not already
  // consumed — this stops a client from skipping the QoreID SDK step
  // entirely by inventing an arbitrary session id.
  async verifyNin(userId: string, nin: string, sessionId: string) {
    this.pruneExpiredLivenessSessions();
    const session = this.pendingLivenessSessions.get(sessionId);
    if (!session || session.userId !== userId) {
      throw new BadRequestException(
        'No matching liveness session — start the liveness check again',
      );
    }
    this.pendingLivenessSessions.delete(sessionId);

    const user = await this.usersService.findById(userId);

    const existing = await this.usersService.findByNin(nin);
    if (existing && existing.id !== userId) {
      throw new ConflictException(
        'This NIN is already linked to another account',
      );
    }

    const nameResult = await this.ninProvider.verify(nin, {
      firstName: user.firstName,
      lastName: user.lastName,
      dob: user.dateOfBirth,
    });
    if (!nameResult.matched) {
      throw new BadRequestException(
        'NIN details do not match your registered name',
      );
    }

    await this.usersService.setNinVerified(userId, nin);

    return { matched: true, verifiedAt: new Date() };
  }

  async submitTierUpgrade(userId: string) {
    const [docs, user] = await Promise.all([
      this.docsRepo.find({ where: { userId } }),
      this.usersService.findById(userId),
    ]);
    const uploaded = new Set(docs.map((doc) => doc.docType));
    const missing = REQUIRED_DOC_TYPES.filter((type) => !uploaded.has(type));
    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing required documents: ${missing.join(', ')}`,
      );
    }
    if (!user.ninVerifiedAt) {
      throw new BadRequestException('NIN has not been verified yet');
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
      ninVerified: Boolean(user.ninVerifiedAt),
    };
  }

  private toSummary(doc: KycDocument) {
    return {
      docType: doc.docType,
      idType: doc.idType,
      uploadedAt: doc.uploadedAt,
    };
  }
}
