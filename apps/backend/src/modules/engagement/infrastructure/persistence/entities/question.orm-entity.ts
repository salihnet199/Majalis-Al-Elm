import {
  Entity, PrimaryColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

/** eg_questions — DB-SCHEMA.md §BC03 */
@Entity({ name: 'eg_questions' })
export class QuestionOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  /** Cross-BC reference — ct_content_items.id. Nullable. No FK (DB-SCHEMA §Cross-BC). */
  @Column({ name: 'content_id', type: 'uuid', nullable: true })
  contentId!: string | null;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'title', length: 500 })
  title!: string;

  @Column({ name: 'body', type: 'text', nullable: true })
  body!: string | null;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'FLAGGED'],
    default: 'PENDING',
  })
  status!: string;

  @Column({ name: 'is_answered', type: 'boolean', default: false })
  isAnswered!: boolean;

  @Column({ name: 'moderated_by', type: 'uuid', nullable: true })
  moderatedBy!: string | null;

  @Column({ name: 'moderated_at', type: 'timestamptz', nullable: true })
  moderatedAt!: Date | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
