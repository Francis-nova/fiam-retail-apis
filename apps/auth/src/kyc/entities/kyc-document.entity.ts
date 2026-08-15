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
