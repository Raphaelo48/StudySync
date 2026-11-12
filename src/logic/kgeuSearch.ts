/**
 * Поиск по расписанию КГЭУ: группы, преподаватели, аудитории.
 * Чистые функции — без сети и БД, покрыты тестами.
 *
 * Отдельного поиска по предмету нет (у API нет справочника дисциплин):
 * предмет фильтруется внутри открытого расписания.
 */
import { startOfDay } from '../core/time';
import type { KgeuTargetKind } from '../models/types';
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

/** Занятия по дням (ключ — начало дня) для месячной сетки. */
export function lessonsByDay<T extends { startAt: number }>(lessons: T[]): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const l of lessons) {
    const day = startOfDay(l.startAt);
    const arr = map.get(day);
    if (arr) arr.push(l);
    else map.set(day, [l]);
  }
  return map;
}

/**
 * День, который стоит открыть первым: сегодня, если есть занятия, иначе ближайший
 * день с занятиями впереди, иначе последний прошедший. Без занятий — сегодня.
 */
export function initialDay<T extends { startAt: number }>(lessons: T[], now: number): number {
  const today = startOfDay(now);
  const days = [...lessonsByDay(lessons).keys()].sort((a, b) => a - b);
  if (days.length === 0) return today;
  return days.find((d) => d >= today) ?? days[days.length - 1]!;
}

/** Ближайший день с занятиями строго после (dir = 1) или до (dir = -1) указанного. */
export function nearestLessonDay<T extends { startAt: number }>(lessons: T[], day: number, dir: 1 | -1): number | null {
  const days = [...lessonsByDay(lessons).keys()].sort((a, b) => a - b);
  if (dir === 1) return days.find((d) => d > day) ?? null;
  return [...days].reverse().find((d) => d < day) ?? null;
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
