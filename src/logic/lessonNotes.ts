/**
 * Ключ пары для конспекта.
 *
 * Импорт КГЭУ может пересоздавать события, поэтому конспект привязан не к id
 * события, а к паре «предмет (или название) + время начала». Если пара
 * перенесена на другое время, конспект остаётся в списке конспектов предмета.
 */
import type { CalendarEvent } from '../models/types';

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\s*\(подгр\.\s*\d+\)\s*$/u, '')
    .replace(/[^a-zа-яё0-9]+/giu, ' ')
    .trim();

export function lessonKeyFor(event: Pick<CalendarEvent, 'subjectId' | 'title' | 'startAt'>): string {
  const who = event.subjectId ? `s:${event.subjectId}` : `t:${norm(event.title)}`;
  return `${who}@${event.startAt}`;
}

/** Конспект можно вести к паре и к любому событию с предметом. */
export function canHaveNote(event: Pick<CalendarEvent, 'kind' | 'subjectId'>): boolean {
  return event.kind === 'lesson' || event.subjectId != null;
}
