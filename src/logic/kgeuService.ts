/**
 * Сервис импорта/синхронизации расписания КГЭУ.
 *
 * Правила:
 * - Импорт идемпотентен: повторный запуск обновляет изменения и удаляет
 *   только те импортированные события, которых больше нет в источнике.
 * - Пользовательские события (source='manual') не изменяются и не удаляются.
 * - Все изменения БД — в одной транзакции; уведомления пересинхронизируются
 *   после успешного применения.
 * - Сеть дёргается только вне транзакции и только по действию пользователя.
 */
import type { AppDatabase } from '../db/database';
import { SUBJECT_COLORS, type ID } from '../models/types';
import { fetchGroupSchedule, type KgeuLessonRow } from './kgeuClient';
import { computeSyncDiff, parseLessonRow, splitDiscipline, type ParsedLesson } from './kgeuImport';
import { cancelEventNotification, syncEventNotification } from '../notifications/scheduler';
import { getNotificationClient } from '../notifications/client';

export interface KgeuImportOptions {
  groupId: number;
  groupName: string;
  year?: string;
  now?: number;
  /** Инжектируется в тестах: вместо сети возвращает фикстуры строк. */
  fetchSchedule?: (groupId: number, year?: string) => Promise<KgeuLessonRow[]>;
}

export interface KgeuImportReport {
  groupName: string;
  lessonsTotal: number;
  inserted: number;
  updated: number;
  removed: number;
  unchanged: number;
  /** Сколько предметов создано; существующие с теми же названиями переиспользуются. */
  subjectsCreated: number;
  minDate: number | null;
  maxDate: number | null;
  replacements: number;
  createdEventIds: ID[];
}

export async function importKgeuSchedule(
  db: AppDatabase,
  opts: KgeuImportOptions
): Promise<KgeuImportReport> {
  const now = opts.now ?? Date.now();
  const fetcher = opts.fetchSchedule ?? fetchGroupSchedule;

  // 1. Сеть — до транзакции.
  const rows = await fetcher(opts.groupId, opts.year);
  const lessons = rows
    .map((r) => parseLessonRow(r, opts.groupId))
    .filter((l): l is ParsedLesson => l != null);

  // 2. Текущее состояние импорта этой группы.
  const existing = await db.events.listBySourceRefPrefix('kgeu', `${opts.groupId}:`);
  const diff = computeSyncDiff(existing, lessons);

  const createdEventIds: ID[] = [];

  // 2.5 Предметы: уникальные названия дисциплин → существующие или новые предметы.
  const normalize = (name: string) => name.trim().toLowerCase();
  const subjectIdByName = new Map<string, ID>();
  const allSubjects = await db.subjects.list(true);
  for (const s of allSubjects) {
    subjectIdByName.set(normalize(s.name), s.id);
  }
  // Предметы, созданные прежними импортами с видом занятия в названии
  // («лек Маркетинг ИТ-продуктов»), переименовываем в чистое название дисциплины.
  const incomingNames = new Set(lessons.map((l) => normalize(l.subjectName)));
  const renames: Array<{ id: ID; name: string }> = [];
  for (const s of allSubjects) {
    const { kindLabel, title } = splitDiscipline(s.name);
    const key = normalize(title);
    if (kindLabel && incomingNames.has(key) && !subjectIdByName.has(key)) {
      renames.push({ id: s.id, name: title });
      subjectIdByName.delete(normalize(s.name));
      subjectIdByName.set(key, s.id);
    }
  }
  const missingNames = [...new Set(lessons.map((l) => l.subjectName))].filter(
    (name) => !subjectIdByName.has(normalize(name))
  );
  const subjectIdFor = (name: string): ID | null => subjectIdByName.get(normalize(name)) ?? null;

  // 3. Применение в транзакции.
  await db.driver.transaction(async () => {
    for (const r of renames) await db.subjects.update(r.id, { name: r.name }, now);
    let colorIndex = 0;
    for (const name of missingNames) {
      const created = await db.subjects.create(
        { name, color: SUBJECT_COLORS[colorIndex % SUBJECT_COLORS.length] },
        now
      );
      colorIndex += 1;
      subjectIdByName.set(normalize(name), created.id);
    }
    for (const item of diff.remove) {
      await db.events.delete(item.id);
    }
    for (const item of diff.update) {
      await db.events.update(
        item.event.id,
        {
          title: item.next.title,
          location: item.next.location,
          notes: item.next.notes,
          startAt: item.next.startAt,
          endAt: item.next.endAt,
          // Если у события ещё не было предмета — привязываем к предмету дисциплины.
          ...(item.event.subjectId == null ? { subjectId: subjectIdFor(item.next.subjectName) } : {}),
        },
        now
      );
    }
    for (const lesson of diff.insert) {
      const created = await db.events.create(
        {
          title: lesson.title,
          kind: 'lesson',
          subjectId: subjectIdFor(lesson.subjectName),
          location: lesson.location,
          notes: lesson.notes,
          startAt: lesson.startAt,
          endAt: lesson.endAt,
          source: 'kgeu',
          sourceRef: lesson.ref,
        },
        now
      );
      createdEventIds.push(created.id);
    }
  });

  // 4. Уведомления — после успешного применения.
  const client = getNotificationClient();
  const settings = await db.settings.get();
  for (const item of diff.remove) {
    await cancelEventNotification(client, item.id);
  }
  for (const item of diff.update) {
    const updated = await db.events.get(item.event.id);
    if (updated) await syncEventNotification(client, settings, updated, now);
  }
  for (const id of createdEventIds) {
    const created = await db.events.get(id);
    if (created) await syncEventNotification(client, settings, created, now);
  }

  const dates = lessons.map((l) => l.startAt);
  return {
    groupName: opts.groupName,
    lessonsTotal: lessons.length,
    inserted: diff.insert.length,
    updated: diff.update.length,
    removed: diff.remove.length,
    unchanged: diff.unchanged,
    subjectsCreated: missingNames.length,
    minDate: dates.length > 0 ? Math.min(...dates) : null,
    maxDate: dates.length > 0 ? Math.max(...dates) : null,
    replacements: lessons.filter((l) => l.isReplacement).length,
    createdEventIds,
  };
}

/** Удалить весь импорт расписания выбранной группы (пользовательские события не трогаются). */
export async function removeKgeuImport(db: AppDatabase, groupId: number): Promise<number> {
  const existing = await db.events.listBySourceRefPrefix('kgeu', `${groupId}:`);
  const client = getNotificationClient();
  await db.driver.transaction(async () => {
    for (const e of existing) await db.events.delete(e.id);
  });
  for (const e of existing) await cancelEventNotification(client, e.id);
  return existing.length;
}
