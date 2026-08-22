import {
  Entity, PrimaryColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

/** eg_answers — DB-SCHEMA.md §BC03 */
@Entity({ name: 'eg_answers' })
export class AnswerOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'question_id', type: 'uuid' })
  questionId!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'body', type: 'text' })
  body!: string;

  @Column({ name: 'is_accepted', type: 'boolean', default: false })
  isAccepted!: boolean;

  /**
   * answered_by_role: captured from JWT payload at answer creation time.
   * Reflects the answerer's role at that moment — immutable after creation.
   * DEFAULT 'User' matches DB-SCHEMA.md §BC03.
   */
  @Column({ name: 'answered_by_role', length: 50, default: 'User' })
  answeredByRole!: string;

  @Column({
    name: 'status',
    type: 'enum',
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'FLAGGED'],
    default: 'PENDING',
  })
  status!: string;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
