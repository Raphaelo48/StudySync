/**
 * Дизайн-токены StudySync: цвета светлой и тёмной темы, отступы, скругления,
 * типографика. Палитра: графитово-синяя основа + фиолетовый акцент,
 * спокойные семантические цвета.
 */

import type { AccentId, FontScale } from '../models/types';

export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  borderSoft: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  onPrimary: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  info: string;
  infoSoft: string;
  track: string;
  overlay: string;
  tabBar: string;
  headerShadow: string;
}

export const darkColors: ThemeColors = {
  bg: '#0F1222',
  surface: '#171B2E',
  surfaceAlt: '#1F2438',
  border: '#2B3152',
  borderSoft: '#222840',
  text: '#ECEEF7',
  textSecondary: '#A6ADCB',
  textMuted: '#6E7699',
  primary: '#8B7CF8',
  primaryPressed: '#7A68F0',
  primarySoft: 'rgba(139, 124, 248, 0.15)',
  onPrimary: '#FFFFFF',
  success: '#3ECF8E',
  successSoft: 'rgba(62, 207, 142, 0.14)',
  warning: '#F5B83D',
  warningSoft: 'rgba(245, 184, 61, 0.14)',
  danger: '#F26D6D',
  dangerSoft: 'rgba(242, 109, 109, 0.14)',
  info: '#5AA7F0',
  infoSoft: 'rgba(90, 167, 240, 0.14)',
  track: '#232A45',
  overlay: 'rgba(5, 7, 15, 0.62)',
  tabBar: '#12162A',
  headerShadow: 'rgba(0, 0, 0, 0.35)',
};

export const lightColors: ThemeColors = {
  bg: '#F5F6FB',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF0F8',
  border: '#DFE3F0',
  borderSoft: '#EAECF5',
  text: '#1A1E2E',
  textSecondary: '#565E78',
  textMuted: '#8A91A8',
  primary: '#6C5CE7',
  primaryPressed: '#5A4BD1',
  primarySoft: 'rgba(108, 92, 231, 0.10)',
  onPrimary: '#FFFFFF',
  success: '#1FA971',
  successSoft: 'rgba(31, 169, 113, 0.12)',
  warning: '#B87F0E',
  warningSoft: 'rgba(184, 127, 14, 0.12)',
  danger: '#D9534F',
  dangerSoft: 'rgba(217, 83, 79, 0.10)',
  info: '#2F7FD1',
  infoSoft: 'rgba(47, 127, 209, 0.10)',
  track: '#E4E7F2',
  overlay: 'rgba(20, 24, 40, 0.45)',
  tabBar: '#FFFFFF',
  headerShadow: 'rgba(20, 24, 40, 0.08)',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radii = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 999,
} as const;

/* ---------------------------------- Акцент ---------------------------------- */


export interface AccentDef {
  id: AccentId;
  label: string;
  light: { primary: string; pressed: string };
  dark: { primary: string; pressed: string };
}

/** Палитра акцентов: в тёмной теме — светлее, чтобы сохранить контраст с фоном. */
export const ACCENTS: AccentDef[] = [
  { id: 'violet', label: 'Фиолетовый', light: { primary: '#6C5CE7', pressed: '#5A4BD1' }, dark: { primary: '#8B7CF8', pressed: '#7A68F0' } },
  { id: 'blue', label: 'Синий', light: { primary: '#2563EB', pressed: '#1D4FC4' }, dark: { primary: '#5B93F5', pressed: '#447FE8' } },
  { id: 'teal', label: 'Бирюзовый', light: { primary: '#0E8A83', pressed: '#0B716B' }, dark: { primary: '#2EC4B6', pressed: '#22ADA0' } },
  { id: 'green', label: 'Зелёный', light: { primary: '#2F8F3E', pressed: '#277733' }, dark: { primary: '#5CC86B', pressed: '#49B358' } },
  { id: 'orange', label: 'Оранжевый', light: { primary: '#D2610F', pressed: '#B3520C' }, dark: { primary: '#F2924A', pressed: '#E57F33' } },
  { id: 'pink', label: 'Розовый', light: { primary: '#D6336C', pressed: '#B82A5C' }, dark: { primary: '#F06A98', pressed: '#E25486' } },
];

export function getAccent(id: AccentId | null | undefined): AccentDef {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0]!;
}

/** '#RRGGBB' + прозрачность → 'rgba(r, g, b, a)'. */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  return `rgba(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)}, ${alpha})`;
}

export function applyAccent(base: ThemeColors, accent: AccentDef, isDark: boolean): ThemeColors {
  const a = isDark ? accent.dark : accent.light;
  return { ...base, primary: a.primary, primaryPressed: a.pressed, primarySoft: hexToRgba(a.primary, isDark ? 0.15 : 0.1) };
}

/* ---------------------------------- Типографика ---------------------------------- */

export const FONT_SCALES: Record<FontScale, number> = { small: 0.9, normal: 1, large: 1.15 };

export const fontSizes = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  display: 32,
  timer: 56,
} as const;

export const fontWeights = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

export type FontSizes = { -readonly [K in keyof typeof fontSizes]: number };

export interface Theme {
  colors: ThemeColors;
  isDark: boolean;
  spacing: typeof spacing;
  radii: typeof radii;
  fontSizes: FontSizes;
  fontWeights: typeof fontWeights;
}

export function scaleFontSizes(scale: FontScale | null | undefined): FontSizes {
  const k = FONT_SCALES[scale ?? 'normal'] ?? 1;
  const out = {} as FontSizes;
  for (const key of Object.keys(fontSizes) as Array<keyof typeof fontSizes>) {
    out[key] = Math.round(fontSizes[key] * k);
  }
  return out;
}

export function buildTheme(isDark: boolean, accent: AccentId = 'violet', fontScale: FontScale = 'normal'): Theme {
  const base = isDark ? darkColors : lightColors;
  return {
    colors: accent === 'violet' ? base : applyAccent(base, getAccent(accent), isDark),
    isDark,
    spacing,
    radii,
    fontSizes: fontScale === 'normal' ? fontSizes : scaleFontSizes(fontScale),
    fontWeights,
  };
}

/** Семантические цвета приоритетов и статусов задач. */
export function priorityColor(colors: ThemeColors, priority: 1 | 2 | 3): string {
  if (priority === 3) return colors.danger;
  if (priority === 2) return colors.warning;
  return colors.info;
}

export function statusColor(colors: ThemeColors, status: string): string {
  switch (status) {
    case 'done':
      return colors.success;
    case 'in_progress':
      return colors.warning;
    case 'deferred':
      return colors.textMuted;
    default:
      return colors.info;
  }
}
