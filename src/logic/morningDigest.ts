/**
 * Утренняя сводка: одно уведомление в день с парами, дедлайнами и отработками.
 *
 * Локальные уведомления хранят текст, зафиксированный при постановке в очередь,
 * поэтому сводки ставятся заранее на DIGEST_DAYS дней и пересобираются при любой
 * пересинхронизации уведомлений (изменение расписания, задач, долгов, настроек).
 *
 * В дни без пар сводка приходит, только если есть дедлайны или отработки.
 */
import { addDays, atMinutes, formatTime, isSameDay, pluralRu, startOfDay } from '../core/time';
import type { Timestamp } from '../core/time';
import type { CalendarEvent, Task } from '../models/types';

export const DIGEST_DAYS = 7;
export const MAX_LESSON_TITLES = 4;
export const MAX_DEADLINES = 2;

export const digestNotificationId = (dayStart: Timestamp): string => {
  const d = new Date(dayStart);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `digest:${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export interface DigestRetake {
  title: string;
  at: Timestamp;
  location: string | null;
}

export interface DigestStage {
  title: string;
  taskTitle: string;
  dueAt: Timestamp;
}

export interface DigestContent {
  title: string;
  body: string;
}

/** Убрать пометку подгруппы из названия пары: «Физика (подгр. 1)» → «Физика». */
function shortLessonTitle(title: string): string {
  return title.replace(/\s*\(подгр\.\s*\d+\)\s*$/u, '').trim();
}

/**
 * Собрать текст сводки на день. Возвращает null, если сообщать нечего
 * (нет пар, дедлайнов сегодня/завтра и отработок).
 */
export function buildDigest(
  dayStart: Timestamp,
  events: CalendarEvent[],
  tasks: Task[],
  retakes: DigestRetake[] = [],
  stages: DigestStage[] = []
): DigestContent | null {
  const day = startOfDay(dayStart);
  const tomorrow = addDays(day, 1);

  const lessons = events
    .filter((e) => e.kind === 'lesson' && isSameDay(e.startAt, day))
    .sort((a, b) => a.startAt - b.startAt);

  const active = tasks.filter((t) => t.status !== 'done' && t.deadlineAt != null);
  const dueToday = active.filter((t) => isSameDay(t.deadlineAt as number, day)).sort((a, b) => (a.deadlineAt as number) - (b.deadlineAt as number));
  const dueTomorrow = active.filter((t) => isSameDay(t.deadlineAt as number, tomorrow)).sort((a, b) => (a.deadlineAt as number) - (b.deadlineAt as number));
  const dayRetakes = retakes.filter((r) => isSameDay(r.at, day)).sort((a, b) => a.at - b.at);
  const dayStages = stages.filter((s) => isSameDay(s.dueAt, day)).sort((a, b) => a.dueAt - b.dueAt);

  if (
    lessons.length === 0 &&
    dueToday.length === 0 &&
    dueTomorrow.length === 0 &&
    dayRetakes.length === 0 &&
    dayStages.length === 0
  ) {
    return null;
  }

  let title: string;
  if (lessons.length > 0) {
    const first = lessons[0]!;
    const where = first.location ? `, ${first.location}` : '';
    title = `Сегодня ${lessons.length} ${pluralRu(lessons.length, 'пара', 'пары', 'пар')} · первая в ${formatTime(first.startAt)}${where}`;
  } else {
    title = 'Сегодня пар нет';
  }

  const lines: string[] = [];
  if (lessons.length > 0) {
    // Одинаковые пары подряд (например, две лабы) называем один раз.
    const names: string[] = [];
    for (const l of lessons) {
      const name = shortLessonTitle(l.title);
      if (names[names.length - 1] !== name) names.push(name);
    }
    const shown = names.slice(0, MAX_LESSON_TITLES).join(', ');
    const more = names.length - MAX_LESSON_TITLES;
    lines.push(more > 0 ? `${shown} и ещё ${more}` : shown);
  }

  const deadlineLines = [
    ...dueToday.map((t) => `Дедлайн: ${t.title} — сегодня до ${formatTime(t.deadlineAt as number)}`),
    ...dayStages.map((s) => `Этап: ${s.title} (${s.taskTitle}) — сегодня`),
    ...dueTomorrow.map((t) => `Дедлайн: ${t.title} — завтра`),
  ];
  lines.push(...deadlineLines.slice(0, MAX_DEADLINES));
  if (deadlineLines.length > MAX_DEADLINES) {
    lines.push(`и ещё ${deadlineLines.length - MAX_DEADLINES} ${pluralRu(deadlineLines.length - MAX_DEADLINES, 'дедлайн', 'дедлайна', 'дедлайнов')}`);
  }

  for (const r of dayRetakes) {
    lines.push(`Отработка: ${r.title} в ${formatTime(r.at)}${r.location ? `, ${r.location}` : ''}`);
  }

  return { title, body: lines.join('\n') };
}

/** Моменты отправки сводок на ближайшие дни (только будущие). */
export function digestFireTimes(timeMin: number, now: Timestamp, days: number = DIGEST_DAYS): Array<{ dayStart: Timestamp; fireAt: Timestamp }> {
  const today = startOfDay(now);
  const out: Array<{ dayStart: Timestamp; fireAt: Timestamp }> = [];
  for (let i = 0; i <= days; i += 1) {
    const dayStart = addDays(today, i);
    const fireAt = atMinutes(dayStart, timeMin);
    if (fireAt > now) out.push({ dayStart, fireAt });
    if (out.length >= days) break;
  }
  return out;
}
