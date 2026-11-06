/**
 * Конфликты событий и поиск свободных интервалов.
 * Чистые функции: не зависят от БД, тестируются изолированно.
 */
import {
  atMinutes,
  intervalMinutes,
  intervalsOverlap,
  subtractIntervals,
  type Interval,
} from '../core/time';
import type { CalendarEvent, ID } from '../models/types';

export interface ConflictPair {
  a: CalendarEvent;
  b: CalendarEvent;
  overlapStart: number;
  overlapEnd: number;
}

/** Все попарные пересечения в наборе событий (каждое пересечение — один раз). */
export function findConflicts(events: CalendarEvent[]): ConflictPair[] {
  const sorted = [...events].sort((x, y) => x.startAt - y.startAt);
  const out: ConflictPair[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      if (b.startAt >= a.endAt) break; // дальше все начинаются ещё позже
      out.push({
        a,
        b,
        overlapStart: Math.max(a.startAt, b.startAt),
        overlapEnd: Math.min(a.endAt, b.endAt),
      });
    }
  }
  return out;
}

/** Множество id событий, у которых есть конфликты. */
export function conflictingIds(events: CalendarEvent[]): Set<ID> {
  const ids = new Set<ID>();
  for (const pair of findConflicts(events)) {
    ids.add(pair.a.id);
    ids.add(pair.b.id);
  }
  return ids;
}

/** События, конфликтующие с заданным интервалом (например, при сохранении формы). */
export function conflictsWithInterval(
  events: CalendarEvent[],
  startAt: number,
  endAt: number,
  ignoreId: ID | null = null
): CalendarEvent[] {
  return events.filter(
    (e) => e.id !== ignoreId && intervalsOverlap(startAt, endAt, e.startAt, e.endAt)
  );
}

/**
 * Свободные интервалы дня в пределах учебного окна.
 * @param dayStartTs   метка начала дня (локальная полночь)
 * @param windowStartMin/​windowEndMin — учебное окно в минутах от полуночи
 * @param busy         занятые интервалы (события и т.п.)
 * @param fromTs       не возвращать интервалы, начинающиеся раньше этой метки (обычно «сейчас»)
 * @param minMinutes   отбросить фрагменты короче этого значения
 */
export function freeSlotsForDay(
  dayStartTs: number,
  windowStartMin: number,
  windowEndMin: number,
  busy: Interval[],
  opts: { fromTs?: number; minMinutes?: number } = {}
): Interval[] {
  const fromTs = opts.fromTs;
  const minMinutes = opts.minMinutes ?? 0;
  let windowStart = atMinutes(dayStartTs, windowStartMin);
  const windowEnd = atMinutes(dayStartTs, windowEndMin);
  if (windowEnd <= windowStart) return [];
  if (fromTs != null && fromTs > windowStart) windowStart = fromTs;
  if (windowEnd <= windowStart) return [];
  const dayBusy = busy.filter((b) => intervalsOverlap(windowStart, windowEnd, b.start, b.end));
  const free = subtractIntervals({ start: windowStart, end: windowEnd }, dayBusy);
  return minMinutes > 0 ? free.filter((iv) => intervalMinutes(iv) >= minMinutes) : free;
}

/** Суммарная занятость (минуты) в пределах дня. */
export function busyMinutesForDay(events: CalendarEvent[], dayStartTs: number): number {
  const dayEnd = dayStartTs + 86_400_000;
  const inside = events
    .filter((e) => intervalsOverlap(dayStartTs, dayEnd, e.startAt, e.endAt))
    .map((e) => ({
      start: Math.max(e.startAt, dayStartTs),
      end: Math.min(e.endAt, dayEnd),
    }));
  // Склеим пересечения, чтобы не считать время дважды.
  const merged: Interval[] = [];
  for (const iv of inside.sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      merged.push({ ...iv });
    }
  }
  return merged.reduce((sum, iv) => sum + intervalMinutes(iv), 0);
}
