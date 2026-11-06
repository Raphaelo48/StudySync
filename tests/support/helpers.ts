/**
 * Фабрики тестовых данных и вспомогательные функции.
 * Все тесты используют фиксированные метки времени — без зависимости от «сейчас».
 */
import { AppDatabase } from '../../src/db/database';
import { createRawSqlJsDatabase, createSqlJsDriver } from './sqljsDriver';
import type { Database as SqlJsDatabase } from 'sql.js';
import { DAY_MS, HOUR_MS, MINUTE_MS, startOfDay } from '../../src/core/time';

/** Фиксированное «сейчас»: 12 октября 2026, 10:00 локального времени. */
export function fixedNow(): number {
  const d = new Date(2026, 9, 12, 10, 0, 0, 0); // месяцы 0-based
  return d.getTime();
}

export function dayStart(offsetDays = 0, hour = 0, minute = 0): number {
  const base = startOfDay(fixedNow());
  return base + offsetDays * DAY_MS + hour * HOUR_MS + minute * MINUTE_MS;
}

export interface TestDb {
  db: AppDatabase;
  raw: SqlJsDatabase;
}

/** Открыть свежую базу (новая схема). */
export async function openTestDb(): Promise<TestDb> {
  const raw = await createRawSqlJsDatabase();
  const db = await AppDatabase.open(createSqlJsDriver(raw));
  return { db, raw };
}

/**
 * «Перезапустить приложение»: открыть новый AppDatabase поверх той же
 * физической базы — проверяет сохранность данных между запусками.
 */
export async function reopenTestDb(raw: SqlJsDatabase): Promise<AppDatabase> {
  return AppDatabase.open(createSqlJsDriver(raw));
}

/** Быстрое наполнение: предмет + задачи + события. */
export async function seedBasicData(db: AppDatabase, now = fixedNow()) {
  const math = await db.subjects.create({ name: 'Математика', color: '#7C6CF0' }, now);
  const physics = await db.subjects.create({ name: 'Физика', color: '#5AA7F0' }, now);

  const task1 = await db.tasks.create(
    {
      title: 'Решить задачи по матанализу',
      subjectId: math.id,
      deadlineAt: now + 2 * DAY_MS,
      plannedMinutes: 60,
      priority: 3,
      difficulty: 3,
    },
    now
  );
  const task2 = await db.tasks.create(
    {
      title: 'Лабораторная по физике',
      subjectId: physics.id,
      deadlineAt: now + 5 * DAY_MS,
      plannedMinutes: 90,
      priority: 2,
      difficulty: 2,
    },
    now
  );
  const task3 = await db.tasks.create({ title: 'Прочитать главу учебника', plannedMinutes: 30, priority: 1 }, now);

  const lesson = await db.events.create(
    {
      title: 'Лекция по матанализу',
      kind: 'lesson',
      subjectId: math.id,
      startAt: dayStart(0, 12, 0),
      endAt: dayStart(0, 13, 30),
    },
    now
  );

  return { math, physics, task1, task2, task3, lesson };
}
