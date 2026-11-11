/**
 * Поиск по расписанию КГЭУ: группы, преподаватели, аудитории, предметы.
 * Чистые функции — без сети и БД, покрыты тестами.
 *
 * Поиск по предмету API личного кабинета не поддерживает (нет справочника
 * дисциплин), поэтому предмет ищется двумя способами: по своему расписанию
 * в приложении и фильтром внутри открытого расписания группы/преподавателя/аудитории.
 */
import { startOfDay } from '../core/time';
import type { CalendarEvent, KgeuTargetKind } from '../models/types';
import type { KgeuLessonRow } from './kgeuClient';
import { extractTeacher, parseIsoLocal, splitDiscipline } from './kgeuImport';

export const SEARCH_LIMIT = 60;

export const KIND_LABELS: Record<KgeuTargetKind, string> = {
  group: 'Группа',
  teacher: 'Преподаватель',
  aud: 'Аудитория',
};

/** Нижний регистр, ё → е, без лишних пробелов. */
export function normalizeQuery(s: string): string {
  return s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function tokens(s: string): string[] {
  return normalizeQuery(s)
    .split(/[\s.,\-–/()]+/)
    .filter(Boolean);
}

/**
 * Совпадает ли название с запросом.
 * - Слова запроса подряд совпадают с началами слов названия: «абакумова ю а» →
 *   «Абакумова Юлия Андреевна», «ю а» → её же, «пи-1» → «ПИ-1-23», но «а-2» не
 *   находит «А-1-22» (номер должен идти на своём месте).
 * - Для запросов без цифр порядок слов не важен: «юлия абакумова».
 * - Запрос без разделителей сравнивается с началом названия: «б301» → «Б-301».
 */
export function matchesQuery(name: string, query: string): boolean {
  const q = tokens(query);
  if (q.length === 0) return true;
  const n = tokens(name);
  for (let start = 0; start + q.length <= n.length; start += 1) {
    if (q.every((qt, k) => n[start + k]!.startsWith(qt))) return true;
  }
  if (!q.some((t) => /\d/.test(t)) && q.every((qt) => n.some((nt) => nt.startsWith(qt)))) return true;
  const compact = (s: string) => normalizeQuery(s).replace(/[\s.,\-–/()]+/g, '');
  const cq = compact(query);
  return cq.length >= 2 && compact(name).startsWith(cq);
}

/** Отфильтровать справочник и отсортировать: сначала названия, начинающиеся с запроса. */
export function searchNamed<T extends { name: string }>(list: T[], query: string, limit = SEARCH_LIMIT): T[] {
  const q = normalizeQuery(query);
  const found = list.filter((x) => matchesQuery(x.name, query));
  const starts = (x: T) => (normalizeQuery(x.name).startsWith(q) ? 0 : 1);
  return found
    .sort((a, b) => starts(a) - starts(b) || a.name.localeCompare(b.name, 'ru'))
    .slice(0, limit);
}

/* ---------------------------------- Просмотр расписания ---------------------------------- */

export interface ViewLesson {
  key: string;
  startAt: number;
  endAt: number;
  title: string;
  kindLabel: string | null;
  subgroup: number;
  teacher: string | null;
  location: string | null;
  groups: string | null;
  isReplacement: boolean;
}

/** Строки API → занятия для просмотра (без записи в БД), по времени, без дублей. */
export function toViewLessons(rows: KgeuLessonRow[]): ViewLesson[] {
  const seen = new Set<string>();
  const out: ViewLesson[] = [];
  for (const row of rows) {
    const startAt = parseIsoLocal(row.датаНачала);
    const endAt = parseIsoLocal(row.датаОкончания);
    if (startAt == null || endAt == null || endAt <= startAt) continue;
    const { kindLabel, title } = splitDiscipline(row.дисциплина);
    const key = `${row.код}:${startAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      startAt,
      endAt,
      title,
      kindLabel,
      subgroup: row.номерПодгруппы ?? 0,
      teacher: extractTeacher(row),
      location: row.аудитория?.trim() || null,
      groups: row.группа?.trim() || null,
      isReplacement: row.замена === true,
    });
  }
  return out.sort((a, b) => a.startAt - b.startAt || a.title.localeCompare(b.title, 'ru'));
}

/** Фильтр по предмету: подстрока названия дисциплины. */
export function filterBySubject(lessons: ViewLesson[], query: string): ViewLesson[] {
  const q = normalizeQuery(query);
  if (!q) return lessons;
  return lessons.filter((l) => normalizeQuery(l.title).includes(q));
}

/** Дисциплины расписания по убыванию числа занятий — для быстрых фильтров. */
export function topDisciplines(lessons: ViewLesson[], limit = 8): string[] {
  const counts = new Map<string, number>();
  for (const l of lessons) counts.set(l.title, (counts.get(l.title) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
    .slice(0, limit)
    .map(([t]) => t);
}

/** Только занятия с начала сегодняшнего дня, если не просят прошедшие. */
export function fromToday<T extends { endAt: number }>(lessons: T[], now: number, includePast: boolean): T[] {
  if (includePast) return lessons;
  const today = startOfDay(now);
  return lessons.filter((l) => l.endAt >= today);
}

export interface DayGroup<T> {
  day: number;
  lessons: T[];
}

export function groupByDay<T extends { startAt: number }>(lessons: T[]): DayGroup<T>[] {
  const out: DayGroup<T>[] = [];
  for (const l of lessons) {
    const day = startOfDay(l.startAt);
    const last = out[out.length - 1];
    if (last && last.day === day) last.lessons.push(l);
    else out.push({ day, lessons: [l] });
  }
  return out;
}

/** Вторая строка карточки: то, чего нет в заголовке просматриваемого расписания. */
export function lessonMeta(l: ViewLesson, kind: KgeuTargetKind): string {
  const sub = l.subgroup > 0 ? `подгр. ${l.subgroup}` : null;
  const parts =
    kind === 'group'
      ? [l.location, l.teacher, sub]
      : kind === 'teacher'
        ? [l.groups, l.location, sub]
        : [l.groups, l.teacher, sub];
  return parts.filter(Boolean).join(' · ');
}

/* ---------------------------------- Предмет в своём расписании ---------------------------------- */

export interface LocalSubjectHit {
  title: string;
  subjectId: string | null;
  total: number;
  upcoming: number;
  nextAt: number | null;
}

/** Название предмета занятия без пометки подгруппы. */
export function baseLessonTitle(title: string): string {
  return title.replace(/\s*\(подгр\.\s*\d+\)\s*$/u, '').trim();
}

/** Предметы своего расписания, подходящие под запрос, со счётчиками и ближайшей парой. */
export function searchLocalSubjects(
  events: Pick<CalendarEvent, 'title' | 'kind' | 'subjectId' | 'startAt' | 'endAt'>[],
  query: string,
  now: number
): LocalSubjectHit[] {
  const q = normalizeQuery(query);
  const map = new Map<string, LocalSubjectHit>();
  for (const e of events) {
    if (e.kind !== 'lesson') continue;
    const title = baseLessonTitle(e.title);
    if (q && !normalizeQuery(title).includes(q)) continue;
    const key = e.subjectId ?? `title:${normalizeQuery(title)}`;
    const hit = map.get(key) ?? { title, subjectId: e.subjectId, total: 0, upcoming: 0, nextAt: null };
    hit.total += 1;
    if (e.endAt >= now) {
      hit.upcoming += 1;
      if (hit.nextAt == null || e.startAt < hit.nextAt) hit.nextAt = e.startAt;
    }
    map.set(key, hit);
  }
  return [...map.values()].sort(
    (a, b) => (a.nextAt ?? Infinity) - (b.nextAt ?? Infinity) || a.title.localeCompare(b.title, 'ru')
  );
}
