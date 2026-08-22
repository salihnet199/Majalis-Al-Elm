/** Tag Domain Entity — BC02 */
import { UUIDv7 } from '../../../shared/domain/uuid.vo';

export class Tag {
  private constructor(
    public readonly id: UUIDv7,
    private _slug: string,
    public readonly createdAt: Date,
  ) {}

  static create(params: { id: UUIDv7; slug: string }): Tag {
    return new Tag(params.id, params.slug, new Date());
  }

  static reconstitute(params: {
    id: string;
    slug: string;
    createdAt: Date;
  }): Tag {
    return new Tag(UUIDv7.fromString(params.id), params.slug, params.createdAt);
  }

  get slug(): string { return this._slug; }
}
