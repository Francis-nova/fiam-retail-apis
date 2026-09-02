import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

export enum KycDocumentType {
  GOVERNMENT_ID_FRONT = 'GOVERNMENT_ID_FRONT',
  GOVERNMENT_ID_BACK = 'GOVERNMENT_ID_BACK',
  NIN_SELFIE = 'NIN_SELFIE',
  PROOF_OF_ADDRESS = 'PROOF_OF_ADDRESS',
}

// Customer-declared before uploading GOVERNMENT_ID_FRONT/BACK — drives which
// document the reviewer expects to see, alongside the OCR text below.
export enum GovernmentIdType {
  NATIONAL_ID = 'NATIONAL_ID',
  DRIVERS_LICENSE = 'DRIVERS_LICENSE',
  VOTERS_CARD = 'VOTERS_CARD',
  INTERNATIONAL_PASSPORT = 'INTERNATIONAL_PASSPORT',
}

// One row per (user, docType) — re-uploading a document replaces the
// previous object in MinIO and this row, rather than accumulating history.
@Entity('kyc_documents')
@Index(['userId', 'docType'], { unique: true })
export class KycDocument {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'doc_type', type: 'enum', enum: KycDocumentType })
  docType: KycDocumentType;

  // Set only for GOVERNMENT_ID_FRONT/BACK — the ID type the customer
  // declared before uploading, so the reviewer knows what to check the OCR
  // text against.
  @Column({
    name: 'id_type',
    type: 'enum',
    enum: GovernmentIdType,
    nullable: true,
  })
  idType: GovernmentIdType | null;

  // Best-effort raw text extracted from the image via OCR, for the
  // reviewer's reference — never used to auto-approve. Null when the
  // document isn't a government ID, the file isn't an image (OCR can't run
  // on a raw PDF), or extraction failed.
  @Column({ name: 'ocr_text', type: 'text', nullable: true })
  ocrText: string | null;

  // MinIO object key — never exposed directly to clients.
  @Column({ name: 'object_key' })
  objectKey: string;

  @Column({ name: 'original_filename' })
  originalFilename: string;

  @Column({ name: 'mime_type' })
  mimeType: string;

  @Column({ name: 'size_bytes', type: 'integer' })
  sizeBytes: number;

  @Column({ name: 'uploaded_at', type: 'timestamptz' })
  uploadedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
