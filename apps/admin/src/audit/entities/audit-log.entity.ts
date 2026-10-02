import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Append-only: nothing in the app updates or deletes these rows.
@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // Nullable for pre-auth events (failed login for an unknown email).
  @Index()
  @Column({ name: 'staff_id', type: 'uuid', nullable: true })
  staffId: string | null;

  @Column({ name: 'staff_email', type: 'varchar', nullable: true })
  staffEmail: string | null;

  @Index()
  @Column()
  action: string;

  @Column({ name: 'resource_type', type: 'varchar', nullable: true })
  resourceType: string | null;

  @Index()
  @Column({ name: 'resource_id', type: 'varchar', nullable: true })
  resourceId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  ip: string | null;

  @Index()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
