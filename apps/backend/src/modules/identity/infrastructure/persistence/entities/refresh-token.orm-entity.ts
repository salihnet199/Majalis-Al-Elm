import { Entity, PrimaryColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { UserOrmEntity } from './user.orm-entity';

/**
 * RefreshTokenOrmEntity — maps id_refresh_tokens table (Migration 003)
 * ADR-008: token_family enables reuse detection (stolen token invalidates family)
 */
@Entity({ name: 'id_refresh_tokens' })
export class RefreshTokenOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => UserOrmEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: UserOrmEntity;

  // SHA-256 hash of the raw refresh token string — never store raw token
  @Column({ name: 'token_hash', length: 64, unique: true })
  tokenHash!: string;

  // All tokens in same rotation chain share a family UUID
  @Column({ name: 'token_family', type: 'uuid' })
  tokenFamily!: string;

  @Column({ name: 'device_name', length: 200, nullable: true })
  deviceName!: string | null;

  @Column({ name: 'device_ip', type: 'inet', nullable: true })
  deviceIp!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @Column({ name: 'is_revoked', default: false })
  isRevoked!: boolean;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
