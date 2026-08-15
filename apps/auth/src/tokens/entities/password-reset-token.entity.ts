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

// Deliberately a standalone hashed-random-token table (mirrors RefreshToken)
// rather than a signed JWT — a JWT would validate against the same access
// secret as real access tokens, and JwtStrategy trusts any payload with a
// matching signature, so a reset token could otherwise double as a bearer
// token on protected routes. This can't be misused that way: it isn't
// JWT-shaped at all, and possession alone isn't enough — it must also be
// unconsumed and unexpired.
@Entity('password_reset_tokens')
export class PasswordResetToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // sha256 of the raw token — the raw value is only ever shown to the client once.
  @Index({ unique: true })
  @Column({ name: 'token_hash' })
  tokenHash: string;

  @Column({ name: 'consumed_at', type: 'timestamptz', nullable: true })
  consumedAt: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
