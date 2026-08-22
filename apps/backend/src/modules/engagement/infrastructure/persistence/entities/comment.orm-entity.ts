import {
  Entity, PrimaryColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

/** eg_comments — DB-SCHEMA.md §BC03 */
@Entity({ name: 'eg_comments' })
export class CommentOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  /** Cross-BC reference — ct_content_items.id. No FK (DB-SCHEMA §Cross-BC). */
  @Column({ name: 'content_id', type: 'uuid' })
  contentId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId!: string | null;

  @Column({ name: 'body', type: 'text' })
  body!: string;

  @Column({ name: 'upvotes_count', type: 'int', default: 0 })
  upvotesCount!: number;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'FLAGGED'],
    default: 'PENDING',
  })
  status!: string;

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
