/**
 * Материализация повторяющихся событий.
 *
 * Подход v1: повторы «разворачиваются» в отдельные записи событий (инстансы),
 * связанные общим seriesId. Это даёт единообразные конфликты, уведомления
 * и календарь без виртуальных сущностей. Правило хранится в каждом инстансе
 * (recurrence), чтобы серию можно было пересоздать при редактировании.
 */
import { DAY_MS, addDays, startOfDay } from '../core/time';
import type { CalendarEvent, RecurrenceRule } from '../models/types';

export const MAX_SERIES_INSTANCES = 400;
/** Горизонт материализации по умолчанию, если правило без `until`: 16 недель. */
export const DEFAULT_SERIES_HORIZON_MS = 16 * 7 * DAY_MS;

export interface SeriesInstance {
  startAt: number;
  endAt: number;
}

/**
 * Развернуть правило повтора в список инстансов.
 * Первый инстанс — всегда исходное событие (даже если его день не входит в daysOfWeek,
 * форма создания это контролирует). Дальнейшие — строго по правилу.
 */
export function expandRecurrence(
  rule: RecurrenceRule,
  firstStartAt: number,
  firstEndAt: number,
  hardLimitTs: number = rule.until ?? firstStartAt + DEFAULT_SERIES_HORIZON_MS,
  maxInstances: number = MAX_SERIES_INSTANCES
): SeriesInstance[] {
  if (firstEndAt <= firstStartAt) return [];
  const duration = firstEndAt - firstStartAt;
  const limit = Math.min(
    rule.until != null ? rule.until : hardLimitTs,
    hardLimitTs
  );
  const countLimit = rule.count != null && rule.count > 0 ? rule.count : maxInstances;
  const instances: SeriesInstance[] = [{ startAt: firstStartAt, endAt: firstEndAt }];
  if (countLimit <= 1) return instances;

  const daysOfWeek = rule.freq === 'weekly' ? new Set(rule.daysOfWeek ?? []) : null;

  let day = addDays(startOfDay(firstStartAt), 1);
  // Защита от бесконечного цикла: максимум maxInstances или limit.
  while (instances.length < Math.min(countLimit, maxInstances) && day <= limit) {
    const dow = new Date(day).getDay();
    const matches = rule.freq === 'daily' || (daysOfWeek !== null && daysOfWeek.has(dow));
    if (matches) {
      const startAt = firstStartAt + (day - startOfDay(firstStartAt));
      if (startAt <= limit) {
        instances.push({ startAt, endAt: startAt + duration });
      } else {
        break;
      }
    }
    day = addDays(day, 1);
  }
  return instances;
}

/** Совпадают ли правила повтора (для решения, пересоздавать ли серию). */
export function sameRecurrenceRule(a: RecurrenceRule | null | undefined, b: RecurrenceRule | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  const days = (r: RecurrenceRule) => (r.freq === 'weekly' ? [...(r.daysOfWeek ?? [])].sort().join(',') : '');
  return a.freq === b.freq && days(a) === days(b) && (a.until ?? null) === (b.until ?? null) && (a.count ?? null) === (b.count ?? null);
}

/** Инстансы серии, которые ещё не наступили (или идут сейчас). */
export function futureSeriesInstances(events: CalendarEvent[], seriesId: string, now: number): CalendarEvent[] {
  return events.filter((e) => e.seriesId === seriesId && e.endAt >= now);
}

/**
 * Пересоздать будущие инстансы серии после изменения правила/времени.
 * Возвращает список новых инстансов (без первого — он редактируется отдельно).
 */
export function rescheduleSeries(
  rule: RecurrenceRule,
  firstStartAt: number,
  firstEndAt: number,
  now: number
): SeriesInstance[] {
  const all = expandRecurrence(rule, firstStartAt, firstEndAt);
  return all.filter((i, idx) => idx > 0 && i.endAt >= now);
}
