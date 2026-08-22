import {
  Entity, PrimaryColumn,
  CreateDateColumn,
} from 'typeorm';

/** eg_comment_votes — DB-SCHEMA.md §BC03 */
@Entity({ name: 'eg_comment_votes' })
export class CommentVoteOrmEntity {
  /** Composite PK: (user_id, comment_id) — prevents duplicate votes at DB level */
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @PrimaryColumn({ name: 'comment_id', type: 'uuid' })
  commentId!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
