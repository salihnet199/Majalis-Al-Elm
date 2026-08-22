/**
 * Translation Domain Entity — BC02
 *
 * Centralised i18n: all translatable text across BC02 entities.
 * TEXT type content body stored as field_name='body' (DB-002: ILIKE on content).
 * Supported locales: ar | en | fr | ur | ms
 */
import { UUIDv7 } from '../../../shared/domain/uuid.vo';

export type SupportedLocale = 'ar' | 'en' | 'fr' | 'ur' | 'ms';

export class Translation {
  private constructor(
    public readonly id: UUIDv7,
    public readonly entityType: string,
    public readonly entityId: string,
    public readonly locale: SupportedLocale,
    public readonly fieldName: string,
    private _content: string,
    public readonly createdBy: string | null,
    private _updatedAt: Date,
  ) {}

  static create(params: {
    id: UUIDv7;
    entityType: string;
    entityId: string;
    locale: SupportedLocale;
    fieldName: string;
    content: string;
    createdBy?: string | null;
  }): Translation {
    return new Translation(
      params.id,
      params.entityType,
      params.entityId,
      params.locale,
      params.fieldName,
      params.content,
      params.createdBy ?? null,
      new Date(),
    );
  }

  static reconstitute(params: {
    id: string;
    entityType: string;
    entityId: string;
    locale: SupportedLocale;
    fieldName: string;
    content: string;
    createdBy: string | null;
    updatedAt: Date;
  }): Translation {
    return new Translation(
      UUIDv7.fromString(params.id),
      params.entityType,
      params.entityId,
      params.locale,
      params.fieldName,
      params.content,
      params.createdBy,
      params.updatedAt,
    );
  }

  get content(): string { return this._content; }
  get updatedAt(): Date { return this._updatedAt; }

  update(newContent: string): void {
    this._content = newContent;
    this._updatedAt = new Date();
  }
}
