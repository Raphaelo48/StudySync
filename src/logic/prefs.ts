/**
 * Персонализация и данные расписания КГЭУ, которые хранятся одним JSON-полем
 * user_settings.prefs_json. Так новые настройки не требуют отдельной колонки
 * на каждое поле, а повреждённое или устаревшее значение не ломает запуск:
 * всё, что не прошло проверку, заменяется значением по умолчанию.
 */
import { z } from 'zod';
import { DEFAULT_SETTINGS, type HomeBlock, type KgeuRecent, type UserSettings } from '../models/types';

export const PREF_KEYS = [
  'accentColor',
  'fontScale',
  'startTab',
  'homeHiddenBlocks',
  'compactSchedule',
  'autoSyncGroup',
  'kgeuGroupId',
  'kgeuGroupName',
  'kgeuLastSyncAt',
  'kgeuRecent',
] as const;
export type PrefKey = (typeof PREF_KEYS)[number];
export type Prefs = Pick<UserSettings, PrefKey>;

export const MAX_RECENT = 8;

export const HOME_BLOCKS: HomeBlock[] = ['stats', 'dayload', 'lessons', 'debts', 'priority', 'deadlines'];

export const accentSchema = z.enum(['violet', 'blue', 'teal', 'green', 'orange', 'pink']);
export const fontScaleSchema = z.enum(['small', 'normal', 'large']);
export const startTabSchema = z.enum(['index', 'schedule', 'tasks']);
export const homeBlockSchema = z.enum(['stats', 'dayload', 'lessons', 'debts', 'priority', 'deadlines']);
export const recentSchema = z.object({
  kind: z.enum(['group', 'teacher', 'aud']),
  id: z.number().int(),
  name: z.string().min(1).max(120),
});

/** Схема каждого поля отдельно: ошибка в одном не сбрасывает остальные. */
const FIELD_SCHEMAS: { [K in PrefKey]: z.ZodType<Prefs[K]> } = {
  accentColor: accentSchema,
  fontScale: fontScaleSchema,
  startTab: startTabSchema,
  homeHiddenBlocks: z.array(homeBlockSchema).max(HOME_BLOCKS.length),
  compactSchedule: z.boolean(),
  autoSyncGroup: z.boolean(),
  kgeuGroupId: z.number().int().nullable(),
  kgeuGroupName: z.string().max(120).nullable(),
  kgeuLastSyncAt: z.number().int().nonnegative().nullable(),
  kgeuRecent: z.array(recentSchema).max(MAX_RECENT * 2),
};

export function defaultPrefs(): Prefs {
  const out = {} as Record<PrefKey, unknown>;
  for (const k of PREF_KEYS) {
    const v = DEFAULT_SETTINGS[k];
    out[k] = Array.isArray(v) ? [...v] : v;
  }
  return out as Prefs;
}

/** Разобрать JSON из БД или объект из резервной копии. Неверные поля → значения по умолчанию. */
export function parsePrefs(raw: unknown): Prefs {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      obj = {};
    }
  }
  const src = obj && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {};
  const out = defaultPrefs() as Record<PrefKey, unknown>;
  for (const k of PREF_KEYS) {
    if (!(k in src)) continue;
    const parsed = FIELD_SCHEMAS[k].safeParse(src[k]);
    if (parsed.success) out[k] = parsed.data;
  }
  const prefs = out as Prefs;
  prefs.homeHiddenBlocks = [...new Set(prefs.homeHiddenBlocks)];
  prefs.kgeuRecent = prefs.kgeuRecent.slice(0, MAX_RECENT);
  return prefs;
}

export function pickPrefs(settings: UserSettings): Prefs {
  const out = {} as Record<PrefKey, unknown>;
  for (const k of PREF_KEYS) out[k] = settings[k];
  return out as Prefs;
}

export function serializePrefs(settings: UserSettings): string {
  return JSON.stringify(pickPrefs(settings));
}

/** Добавить запрос в начало списка недавних (без дублей, не больше MAX_RECENT). */
export function pushRecent(list: KgeuRecent[], item: KgeuRecent): KgeuRecent[] {
  const rest = list.filter((r) => !(r.kind === item.kind && r.id === item.id));
  return [item, ...rest].slice(0, MAX_RECENT);
}

export function toggleHomeBlock(hidden: HomeBlock[], block: HomeBlock, visible: boolean): HomeBlock[] {
  const set = new Set(hidden);
  if (visible) set.delete(block);
  else set.add(block);
  return HOME_BLOCKS.filter((b) => set.has(b));
}
