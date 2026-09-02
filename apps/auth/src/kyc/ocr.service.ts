import { Injectable, Logger } from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import { KYC_IMAGE_MIME_TYPES } from './kyc.constants';

const OCR_ELIGIBLE_MIME_TYPES = new Set(KYC_IMAGE_MIME_TYPES);

// Best-effort text extraction from an uploaded government-ID image, purely
// to give a human reviewer a head start (never used to auto-approve/reject).
// Runs locally via tesseract.js — no external OCR account/credentials
// needed, unlike the QoreID identity checks elsewhere in this module.
@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  canProcess(mimeType: string): boolean {
    return OCR_ELIGIBLE_MIME_TYPES.has(mimeType);
  }

  // Never throws — OCR is a best-effort aid, so any failure (corrupt image,
  // worker crash, unsupported content) just means no text for the reviewer
  // to see, not a blocked upload.
  async extractText(buffer: Buffer, mimeType: string): Promise<string | null> {
    if (!this.canProcess(mimeType)) return null;

    const worker = await createWorker('eng');
    try {
      const {
        data: { text },
      } = await worker.recognize(buffer);
      const trimmed = text.trim();
      return trimmed.length > 0 ? trimmed : null;
    } catch (err) {
      this.logger.warn(`OCR extraction failed: ${(err as Error).message}`);
      return null;
    } finally {
      await worker.terminate().catch(() => {});
    }
  }
}
