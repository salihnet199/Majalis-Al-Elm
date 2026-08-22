/**
 * Visual Identity Design Tokens for 'مجالس العالم'
 * Warm Mocha Brown & Antique Gold Heritage Palette
 * Shared across React Admin and exportable to Flutter.
 */

export const THEME_COLORS = {
  // Backgrounds & Surfaces (Mocha & Espresso)
  bgBase: '#231812',
  bgContainer: '#2D1F18',
  bgCard: '#36251D',
  bgElevated: '#422F25',
  bgGlass: 'rgba(45, 31, 24, 0.85)',
  
  // Antique Gold & Amber Accents
  goldPrimary: '#D4AF37',
  goldHover: '#E5C158',
  goldActive: '#B89326',
  goldLight: '#F5E6BE',
  goldMuted: 'rgba(212, 175, 55, 0.15)',
  
  // High-Contrast Warm Typography
  textPrimary: '#FDFBF7',
  textSecondary: '#C5B8A5',
  textMuted: '#968978',
  
  // Borders & Dividers
  borderGold: 'rgba(212, 175, 55, 0.25)',
  borderMuted: 'rgba(212, 175, 55, 0.12)',
  
  // Status Colors (Warm Palette)
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
} as const;

export const TYPOGRAPHY_CONFIG = {
  fontRuqaa: "'Aref Ruqaa', serif",
  fontCairo: "'Cairo', system-ui, -apple-system, sans-serif",
  fontAmiri: "'Amiri', serif",
} as const;
