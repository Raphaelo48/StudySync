/**
 * Утилиты работы с датой и временем.
 *
 * Соглашения проекта:
 * - Все временные метки хранятся и передаются как целые числа — миллисекунды
 *   с эпохи Unix (UTC). Это однозначный формат, не зависящий от часового пояса.
 * - Все вычисления «дня», «недели», «месяца» выполняются в локальном часовом
 *   поясе устройства (через обычные конструкторы Date), что соответствует
 *   ожиданиям пользователя.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export type Timestamp = number;

export const WEEKDAY_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export const WEEKDAY_FULL = [
  'Воскресенье',
  'Понедельник',
  'Вторник',
  'Среда',
  'Четверг',
  'Пятница',
  'Суббота',
];
export const MONTH_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];
export const MONTH_NOMINATIVE = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
];

export function startOfDay(ts: Timestamp): Timestamp {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(ts: Timestamp): Timestamp {
  return startOfDay(ts) + DAY_MS - 1;
}

export function addDays(ts: Timestamp, days: number): Timestamp {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function addMinutes(ts: Timestamp, minutes: number): Timestamp {
  return ts + minutes * MINUTE_MS;
}

export function isSameDay(a: Timestamp, b: Timestamp): boolean {
  return startOfDay(a) === startOfDay(b);
}

export function isSameMonth(a: Timestamp, b: Timestamp): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth();
}

export function isToday(ts: Timestamp, now: Timestamp = Date.now()): boolean {
  return isSameDay(ts, now);
}

/**
 * Начало недели в локальной зоне. weekStart: 1 = понедельник, 0 = воскресенье.
 */
export function startOfWeek(ts: Timestamp, weekStart: 0 | 1 = 1): Timestamp {
  const d = new Date(startOfDay(ts));
  const dow = d.getDay();
  const diff = weekStart === 1 ? (dow + 6) % 7 : dow;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

export function endOfWeek(ts: Timestamp, weekStart: 0 | 1 = 1): Timestamp {
  return startOfWeek(ts, weekStart) + 7 * DAY_MS - 1;
}

export function startOfMonth(ts: Timestamp): Timestamp {
  const d = new Date(ts);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfMonth(ts: Timestamp): Timestamp {
  const d = new Date(ts);
  d.setMonth(d.getMonth() + 1, 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime() - 1;
}

/** Массив из 7 меток — дни недели, начиная с ts, находящегося в начале недели. */
export function weekDays(weekStartTs: Timestamp): Timestamp[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStartTs, i));
}

/**
 * Сетка месяца (недели целиком, начиная с weekStart): массив меток понедельников/воскресений
 * для строк сетки. Возвращает метки всех ячеек (4–6 строк по 7 дней).
 */
export function monthGridDays(anyDayInMonth: Timestamp, weekStart: 0 | 1 = 1): Timestamp[] {
  const first = startOfMonth(anyDayInMonth);
  const gridStart = startOfWeek(first, weekStart);
  const monthEnd = endOfMonth(anyDayInMonth);
  const weeks = Math.ceil((startOfDay(monthEnd) - gridStart + 1) / (7 * DAY_MS));
  const rows = Math.max(4, Math.min(6, weeks));
  return Array.from({ length: rows * 7 }, (_, i) => addDays(gridStart, i));
}

/** «HH:MM» в локальной зоне. */
export function formatTime(ts: Timestamp): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** «5 окт» / «5 октября 2026» — короткий формат даты. */
export function formatDateShort(ts: Timestamp): string {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTH_GENITIVE[d.getMonth()]}`;
}

export function formatDateFull(ts: Timestamp): string {
  const d = new Date(ts);
  const yearSuffix = d.getFullYear() === new Date().getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTH_GENITIVE[d.getMonth()]}${yearSuffix}`;
}

/** «Пн, 5 октября» */
export function formatDateWithWeekday(ts: Timestamp): string {
  const d = new Date(ts);
  return `${WEEKDAY_SHORT[d.getDay()]}, ${formatDateFull(ts)}`;
}

/** Человекочитаемый интервал: «1 ч 25 мин», «45 мин». */
export function formatDurationMinutes(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(m / 60);
  const minutes = m % 60;
  if (hours === 0) return `${minutes} мин`;
  if (minutes === 0) return `${hours} ч`;
  return `${hours} ч ${minutes} мин`;
}

/** «25:04» / «1:02:03» — формат таймера из секунд. */
export function formatSecondsClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mmss = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return hh > 0 ? `${hh}:${mmss}` : mmss;
}

/** Относительная формулировка дедлайна: «сегодня», «завтра», «просрочено на N дн.» и т.п. */
export function relativeDayLabel(ts: Timestamp, now: Timestamp = Date.now()): string {
  const dayDiff = Math.round((startOfDay(ts) - startOfDay(now)) / DAY_MS);
  if (dayDiff === 0) return 'сегодня';
  if (dayDiff === 1) return 'завтра';
  if (dayDiff === -1) return 'вчера';
  if (dayDiff < 0) return `${formatDateShort(ts)}`;
  if (dayDiff < 7) return `${WEEKDAY_FULL[(startOfDay(ts) === ts ? new Date(ts) : new Date(ts)).getDay()].toLowerCase()}, ${formatDateShort(ts)}`;
  return formatDateShort(ts);
}

/** Осталось времени до метки: «2 ч 15 мин», «меньше часа»; для прошедших — null. */
export function timeUntilLabel(ts: Timestamp, now: Timestamp = Date.now()): string | null {
  const diff = ts - now;
  if (diff <= 0) return null;
  const minutes = Math.floor(diff / MINUTE_MS);
  if (minutes < 60) return `${minutes} мин`;
  return formatDurationMinutes(minutes);
}

export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** Пересечение полуинтервалов [aStart, aEnd) и [bStart, bEnd). */
export function intervalsOverlap(aStart: Timestamp, aEnd: Timestamp, bStart: Timestamp, bEnd: Timestamp): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface Interval {
  start: Timestamp;
  end: Timestamp;
}

/** Вычитание набора занятых интервалов из базового интервала. Результат отсортирован, без пересечений. */
export function subtractIntervals(base: Interval, busy: Interval[]): Interval[] {
  let pieces: Interval[] = [{ start: base.start, end: base.end }];
  const sorted = [...busy].sort((a, b) => a.start - b.start);
  for (const b of sorted) {
    if (b.end <= b.start) continue;
    const next: Interval[] = [];
    for (const p of pieces) {
      if (b.end <= p.start || b.start >= p.end) {
        next.push(p);
        continue;
      }
      if (b.start > p.start) next.push({ start: p.start, end: b.start });
      if (b.end < p.end) next.push({ start: b.end, end: p.end });
    }
    pieces = next;
  }
  return pieces.filter((p) => p.end > p.start);
}

/** Минуты в интервале (округление вниз). */
export function intervalMinutes(iv: Interval): number {
  return Math.max(0, Math.floor((iv.end - iv.start) / MINUTE_MS));
}

/**
 * Метка времени → минуты от начала локальных суток.
 */
export function minutesOfDay(ts: Timestamp): number {
  const d = new Date(ts);
  return d.getHours() * 60 + d.getMinutes();
}

/** Собрать метку из дня (метки начала дня) и минут от начала суток. */
export function atMinutes(dayStartTs: Timestamp, minutes: number): Timestamp {
  return dayStartTs + minutes * MINUTE_MS;
}

export function isValidTimestamp(value: unknown): value is Timestamp {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
