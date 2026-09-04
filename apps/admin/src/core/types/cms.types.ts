export type UiSection = 'HEADER' | 'DASHBOARD' | 'ABOUT_SHEIKH' | 'LOGIN' | 'FOOTER' | 'GENERAL';

export interface UiTextItem {
  id: string;
  key: string;
  section: UiSection;
  locale: string;
  value: string;
  defaultValue: string;
  description: string;
  updatedBy?: string;
  updatedAt: string;
}

export interface UiBlockItem {
  id: string;
  code: string;
  titleAr: string;
  isEnabled: boolean;
  isSystem: boolean;
  sortOrder: number;
  customPayload?: Record<string, unknown>;
  updatedAt: string;
}

export interface UiConfigResponse {
  texts: Record<string, string>;
  blocks: Record<string, boolean>;
}
