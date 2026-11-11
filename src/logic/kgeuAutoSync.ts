/**
 * Автообновление расписания своей группы при открытии приложения.
 *
 * Включается в настройках (по умолчанию включено, но работает только когда
 * группа уже импортирована). Запрос выполняется не чаще раза в
 * AUTO_SYNC_INTERVAL_MS — открытие приложения несколько раз подряд не
 * нагружает сервер КГЭУ. Фонового опроса нет: только при запуске и при
 * возвращении приложения из фона.
 */
import type { AppDatabase } from '../db/database';
import type { UserSettings } from '../models/types';
import { importKgeuSchedule, type KgeuImportReport } from './kgeuService';
import { fetchGroupSchedule, type KgeuLessonRow } from './kgeuClient';

export const AUTO_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type AutoSyncSkip = 'disabled' | 'no-group' | 'recent' | 'onboarding' | 'empty-response';

/** Своя группа: из настроек, а для импортов до этой версии — из ссылок импортированных событий. */
export async function resolveOwnGroup(
  db: AppDatabase,
  settings: UserSettings
): Promise<{ id: number; name: string } | null> {
  if (settings.kgeuGroupId != null) {
    return { id: settings.kgeuGroupId, name: settings.kgeuGroupName ?? 'моя группа' };
  }
  const events = await db.events.listBySourceRefPrefix('kgeu', '');
  const ids = new Set<number>();
  for (const e of events) {
    const id = Number((e.sourceRef ?? '').split(':')[0]);
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  // Импортировано несколько групп — не угадываем, какая своя.
  if (ids.size !== 1) return null;
  return { id: [...ids][0]!, name: 'моя группа' };
}

export function autoSyncSkipReason(settings: UserSettings, now: number): AutoSyncSkip | null {
  if (!settings.onboardingDone) return 'onboarding';
  if (!settings.autoSyncGroup) return 'disabled';
  if (settings.kgeuLastSyncAt != null && now - settings.kgeuLastSyncAt < AUTO_SYNC_INTERVAL_MS) return 'recent';
  return null;
}

export type AutoSyncResult =
  | { status: 'skipped'; reason: AutoSyncSkip }
  | { status: 'synced'; groupName: string; report: KgeuImportReport; changes: number };

/**
 * Обновить расписание своей группы, если пора. Ошибки сети пробрасываются —
 * вызывающий код решает, показывать ли их (при автообновлении — нет).
 */
export async function runAutoSync(
  db: AppDatabase,
  opts: {
    now?: number;
    fetchSchedule?: (groupId: number, year?: string) => Promise<KgeuLessonRow[]>;
  } = {}
): Promise<AutoSyncResult> {
  const now = opts.now ?? Date.now();
  const settings = await db.settings.get();
  const skip = autoSyncSkipReason(settings, now);
  if (skip) return { status: 'skipped', reason: skip };
  const group = await resolveOwnGroup(db, settings);
  if (!group) return { status: 'skipped', reason: 'no-group' };

  const fetcher = opts.fetchSchedule ?? fetchGroupSchedule;
  const rows = await fetcher(group.id);
  // Пустой ответ (сбой сервера, межсессионный период) не должен молча стереть
  // расписание: в автоматическом режиме такие изменения не применяем.
  if (rows.length === 0) return { status: 'skipped', reason: 'empty-response' };

  const report = await importKgeuSchedule(db, {
    groupId: group.id,
    groupName: group.name,
    now,
    fetchSchedule: async () => rows,
  });
  await db.settings.update(
    { kgeuGroupId: group.id, kgeuGroupName: settings.kgeuGroupName ?? group.name, kgeuLastSyncAt: now },
    now
  );
  return { status: 'synced', groupName: group.name, report, changes: report.inserted + report.updated + report.removed };
}
