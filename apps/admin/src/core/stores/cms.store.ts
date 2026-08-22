import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { UiBlockItem, UiTextItem } from '../types/cms.types';

interface CmsState {
  texts: Record<string, UiTextItem>;
  blocks: Record<string, UiBlockItem>;
  
  // Getters
  getText: (key: string, fallback: string) => string;
  isBlockEnabled: (code: string, defaultState?: boolean) => boolean;
  
  // Actions
  updateText: (key: string, value: string) => void;
  resetText: (key: string) => void;
  toggleBlock: (code: string, isEnabled: boolean) => void;
  deleteBlock: (code: string) => boolean;
  addBlock: (block: UiBlockItem) => void;
}

const DEFAULT_UI_TEXTS: Record<string, UiTextItem> = {
  'header.brand_title': {
    id: '1',
    key: 'header.brand_title',
    section: 'HEADER',
    locale: 'ar',
    value: 'مجالس العلم',
    defaultValue: 'مجالس العلم',
    description: 'شعار واسم المنصة الرئيسي في أعلى الترويسة',
    updatedAt: new Date().toISOString(),
  },
  'header.sheikh_subtitle': {
    id: '2',
    key: 'header.sheikh_subtitle',
    section: 'HEADER',
    locale: 'ar',
    value: 'فضيلة الشيخ علي الويسي حفظه الله',
    defaultValue: 'فضيلة الشيخ علي الويسي حفظه الله',
    description: 'العنوان الفرعي تحت شعار المنصة في الترويسة',
    updatedAt: new Date().toISOString(),
  },
  'header.basmala': {
    id: '3',
    key: 'header.basmala',
    section: 'HEADER',
    locale: 'ar',
    value: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
    defaultValue: 'بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ',
    description: 'البسملة التراثية الشريفة أعلى الترويسة',
    updatedAt: new Date().toISOString(),
  },
  'sheikh.title': {
    id: '4',
    key: 'sheikh.title',
    section: 'ABOUT_SHEIKH',
    locale: 'ar',
    value: 'فضيلة الشيخ علي الويسي حفظه الله',
    defaultValue: 'فضيلة الشيخ علي الويسي حفظه الله',
    description: 'اللقب والاسم الكامل لصاحب المجلس في البطاقة التعريفية',
    updatedAt: new Date().toISOString(),
  },
  'sheikh.role_label': {
    id: '5',
    key: 'sheikh.role_label',
    section: 'ABOUT_SHEIKH',
    locale: 'ar',
    value: 'المشرف العام وصاحب مجلس العلم والفتوى',
    defaultValue: 'المشرف العام وصاحب مجلس العلم والفتوى',
    description: 'الوصف الوظيفي والدعوي لصاحب المجلس',
    updatedAt: new Date().toISOString(),
  },
  'sheikh.bio': {
    id: '6',
    key: 'sheikh.bio',
    section: 'ABOUT_SHEIKH',
    locale: 'ar',
    value:
      'فضيلة الشيخ علي الويسي — عالم وداعية إسلامي، يُعنى بنشر العلوم الشرعية، تدريس كتب الفقه والعقيدة، والإجابة عن الفتاوى والاستشارات الشرعية لطلاب العلم وعموم المسلمين.',
    defaultValue:
      'فضيلة الشيخ علي الويسي — عالم وداعية إسلامي، يُعنى بنشر العلوم الشرعية، تدريس كتب الفقه والعقيدة، والإجابة عن الفتاوى والاستشارات الشرعية لطلاب العلم وعموم المسلمين.',
    description: 'النبذة التعريفية والسيرة الموجزة لفضيلة الشيخ',
    updatedAt: new Date().toISOString(),
  },
  'dashboard.welcome_title': {
    id: '7',
    key: 'dashboard.welcome_title',
    section: 'DASHBOARD',
    locale: 'ar',
    value: 'لوحة المؤشرات والتحليلات العامة — مجالس العلم',
    defaultValue: 'لوحة المؤشرات والتحليلات العامة — مجالس العلم',
    description: 'عنوان لوحة التحكم الرئيسي',
    updatedAt: new Date().toISOString(),
  },
  'dashboard.welcome_desc': {
    id: '8',
    key: 'dashboard.welcome_desc',
    section: 'DASHBOARD',
    locale: 'ar',
    value: 'متابعة إحصائيات الدروس، الفتاوى، المستمعين، وحالة البنية التحتية للمنصة',
    defaultValue: 'متابعة إحصائيات الدروس، الفتاوى، المستمعين، وحالة البنية التحتية للمنصة',
    description: 'الوصف الفرعي لبانر لوحة التحكم',
    updatedAt: new Date().toISOString(),
  },
  'login.subtitle': {
    id: '9',
    key: 'login.subtitle',
    section: 'LOGIN',
    locale: 'ar',
    value: 'فضيلة الشيخ علي الويسي — بوابة الإدارة',
    defaultValue: 'فضيلة الشيخ علي الويسي — بوابة الإدارة',
    description: 'العنوان الفرعي في شاشة تسجيل الدخول',
    updatedAt: new Date().toISOString(),
  },
};

const DEFAULT_UI_BLOCKS: Record<string, UiBlockItem> = {
  'widget_about_sheikh': {
    id: 'b1',
    code: 'widget_about_sheikh',
    titleAr: 'بطاقة "عن صاحب المجلس" (السيرة والصورة)',
    isEnabled: true,
    isSystem: true,
    sortOrder: 1,
    updatedAt: new Date().toISOString(),
  },
  'widget_quick_stats': {
    id: 'b2',
    code: 'widget_quick_stats',
    titleAr: 'شريط الإحصائيات السريعة (المواد، المشاهدات، الطلاب)',
    isEnabled: true,
    isSystem: true,
    sortOrder: 2,
    updatedAt: new Date().toISOString(),
  },
  'widget_top_content': {
    id: 'b3',
    code: 'widget_top_content',
    titleAr: 'جدول المواد العلمية الأكثر قراءة واستماعاً',
    isEnabled: true,
    isSystem: true,
    sortOrder: 3,
    updatedAt: new Date().toISOString(),
  },
  'widget_announcements_banner': {
    id: 'b4',
    code: 'widget_announcements_banner',
    titleAr: 'لافتة التنبيهات والإعلانات السريعة',
    isEnabled: true,
    isSystem: false,
    sortOrder: 4,
    updatedAt: new Date().toISOString(),
  },
};

export const useCmsStore = create<CmsState>()(
  persist(
    (set, get) => ({
      texts: DEFAULT_UI_TEXTS,
      blocks: DEFAULT_UI_BLOCKS,

      getText: (key, fallback) => {
        const state = get();
        return state.texts[key]?.value || fallback;
      },

      isBlockEnabled: (code, defaultState = true) => {
        const state = get();
        if (state.blocks[code] !== undefined) {
          return state.blocks[code].isEnabled;
        }
        return defaultState;
      },

      updateText: (key, value) => {
        set((state) => {
          const existing = state.texts[key];
          if (existing) {
            return {
              texts: {
                ...state.texts,
                [key]: {
                  ...existing,
                  value,
                  updatedAt: new Date().toISOString(),
                },
              },
            };
          }
          return state;
        });
      },

      resetText: (key) => {
        set((state) => {
          const existing = state.texts[key];
          if (existing) {
            return {
              texts: {
                ...state.texts,
                [key]: {
                  ...existing,
                  value: existing.defaultValue,
                  updatedAt: new Date().toISOString(),
                },
              },
            };
          }
          return state;
        });
      },

      toggleBlock: (code, isEnabled) => {
        set((state) => {
          const existing = state.blocks[code];
          if (existing) {
            return {
              blocks: {
                ...state.blocks,
                [code]: {
                  ...existing,
                  isEnabled,
                  updatedAt: new Date().toISOString(),
                },
              },
            };
          }
          return state;
        });
      },

      deleteBlock: (code) => {
        const state = get();
        const existing = state.blocks[code];
        if (!existing || existing.isSystem) {
          return false; // Cannot delete system block
        }
        const updated = { ...state.blocks };
        delete updated[code];
        set({ blocks: updated });
        return true;
      },

      addBlock: (block) => {
        set((state) => ({
          blocks: {
            ...state.blocks,
            [block.code]: block,
          },
        }));
      },
    }),
    {
      name: 'majlis_cms_store',
    },
  ),
);
