/**
 * Что показывать в карточке события под названием.
 *
 * У занятий, импортированных из КГЭУ, вид занятия, преподаватель, признак замены
 * и номер пары лежат в notes в виде «Лекция · Иванов И. И. · замена · пара №2»
 * (см. parseLessonRow). Здесь эти части разбираются обратно, чтобы карточка
 * показывала аудиторию и преподавателя, а не повторяла название.
 */
import type { EventWithRelations } from '../models/types';
import { LESSON_KIND_LABELS } from './kgeuImport';

export interface EventDisplay {
  /** Вид занятия: «Лекция», «Практическое занятие»… (только для импорта КГЭУ). */
  kindLabel: string | null;
  teacher: string | null;
  location: string | null;
  isReplacement: boolean;
  /** Предмет, если его название не совпадает с названием события. */
  subjectName: string | null;
}

const KIND_LABEL_SET = new Set(Object.values(LESSON_KIND_LABELS));

const norm = (s: string) => s.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, ' ').trim();

/** Части заметки импорта; разделитель «·» допускаем с любыми пробелами вокруг. */
function splitNotes(notes: string): string[] {
  return notes
    .split(/\s*[·•]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Заметка сгенерирована импортом КГЭУ? Источник может быть не заполнен (например,
 * в событиях, прочитанных старой версией репозитория), поэтому узнаём импорт и по
 * ссылке «группа:код», и по самой заметке — в ней есть вид занятия или «пара №N».
 */
function looksImported(event: EventWithRelations): boolean {
  if (event.source === 'kgeu') return true;
  if (event.sourceRef && /^\d+:\d+$/.test(event.sourceRef)) return true;
  return splitNotes(event.notes ?? '').some((p) => KIND_LABEL_SET.has(p) || /^пара №\d+$/.test(p));
}

export function describeEvent(event: EventWithRelations): EventDisplay {
  let kindLabel: string | null = null;
  let teacher: string | null = null;
  let isReplacement = false;

  if (event.kind === 'lesson' && event.notes && looksImported(event)) {
    const rest: string[] = [];
    for (const part of splitNotes(event.notes)) {
      if (KIND_LABEL_SET.has(part)) kindLabel = part;
      else if (part === 'замена') isReplacement = true;
      else if (/^пара №\d+$/.test(part)) continue;
      else rest.push(part);
    }
    teacher = rest.length > 0 ? rest.join(', ') : null;
  }

  const subject = event.subject?.name ?? null;
  const subjectName = subject && !norm(event.title).includes(norm(subject)) ? subject : null;

  return { kindLabel, teacher, location: event.location ?? null, isReplacement, subjectName };
}
