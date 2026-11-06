/**
 * Разбор строк расписания КГЭУ и расчёт синхронизационного диффа.
 * Чистые функции: без сети и БД, полностью покрыты тестами.
 */
import type { CalendarEvent } from '../models/types';
import type { KgeuLessonRow } from './kgeuClient';

export const LESSON_KIND_LABELS: Record<string, string> = {
  л: 'Лекция',
  лек: 'Лекция',
  пр: 'Практическое занятие',
  прак: 'Практическое занятие',
  сем: 'Семинар',
  лр: 'Лабораторная работа',
  лаб: 'Лабораторная работа',
  конс: 'Консультация',
  экз: 'Экзамен',
  зач: 'Зачёт',
  курс: 'Курсовое проектирование',
};

export interface ParsedLesson {
  /** Уникальная ссылка источника: '<groupId>:<код строки>'. */
  ref: string;
  startAt: number;
  endAt: number;
  /** Название дисциплины без вида занятия и подгруппы — основа для предмета. */
  subjectName: string;
  title: string;
  kindLabel: string | null;
  location: string | null;
  notes: string | null;
  subgroup: number;
  isReplacement: boolean;
  studyYear: string | null;
}

/**
 * '2026-09-02T09:40:00' → метка времени в ЛОКАЛЬНОЙ зоне устройства.
 * Намеренно не используем Date.parse: строка без часового пояса должна
 * трактоваться как настенное время (время пары в вузе), а не UTC.
 */
export function parseIsoLocal(ts: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(ts);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0), 0);
  const value = date.getTime();
  return Number.isFinite(value) ? value : null;
}

/** 'пр Атомные электрические станции' → { kindLabel: 'Практическое занятие', title: 'Атомные электрические станции' }. */
export function splitDiscipline(raw: string): { kindLabel: string | null; title: string } {
  const trimmed = raw.trim();
  const m = /^([а-яa-zё]+)\.?\s+(.+)$/i.exec(trimmed);
  if (m) {
    const prefix = m[1]!.toLowerCase();
    const rest = m[2]!.trim();
    const kindLabel = LESSON_KIND_LABELS[prefix];
    if (kindLabel && rest.length > 0) return { kindLabel, title: rest };
  }
  return { kindLabel: null, title: trimmed };
}

/** Строка с ФИО из значения поля: строка, массив строк или объект с ФИО. */
function teacherText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    const parts = value.map(teacherText).filter((v): v is string => v != null);
    return parts.length > 0 ? parts.join(', ') : null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/фио|имя|name|fio/i.test(k)) {
        const t = teacherText(v);
        if (t) return t;
      }
    }
  }
  return null;
}

/**
 * Преподаватель занятия. Основное поле — «преподаватель», но API личного кабинета
 * неофициальный, поэтому на случай другого имени поля ищем любое поле про
 * преподавателя или ФИО.
 */
export function extractTeacher(row: KgeuLessonRow): string | null {
  const direct = teacherText(row.преподаватель);
  if (direct) return direct;
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    if (/препод|фио|teacher|prepod|lecturer/i.test(key)) {
      const t = teacherText(value);
      if (t) return t;
    }
  }
  return null;
}

export function parseLessonRow(row: KgeuLessonRow, groupId: number): ParsedLesson | null {
  const startAt = parseIsoLocal(row.датаНачала);
  const endAt = parseIsoLocal(row.датаОкончания);
  if (startAt == null || endAt == null || endAt <= startAt) return null;

  const { kindLabel, title } = splitDiscipline(row.дисциплина);
  const subgroup = row.номерПодгруппы ?? 0;
  const isReplacement = row.замена === true;

  const noteParts: string[] = [];
  if (kindLabel) noteParts.push(kindLabel);
  const teacher = extractTeacher(row);
  if (teacher) noteParts.push(teacher);
  if (isReplacement) noteParts.push('замена');
  if (row.номерЗанятия != null && row.номерЗанятия > 0) noteParts.push(`пара №${row.номерЗанятия}`);

  return {
    ref: `${groupId}:${row.код}`,
    startAt,
    endAt,
    subjectName: title,
    title: subgroup > 0 ? `${title} (подгр. ${subgroup})` : title,
    kindLabel,
    location: row.аудитория || null,
    notes: noteParts.length > 0 ? noteParts.join(' · ') : null,
    subgroup,
    isReplacement,
    studyYear: row.учебныйГод ?? null,
  };
}

/* ---------------------------------- Синхронизация ---------------------------------- */

export interface SyncDiff {
  insert: ParsedLesson[];
  update: Array<{ event: CalendarEvent; next: ParsedLesson }>;
  remove: CalendarEvent[];
  unchanged: number;
}

function sameContent(e: CalendarEvent, p: ParsedLesson): boolean {
  return (
    e.startAt === p.startAt &&
    e.endAt === p.endAt &&
    e.title === p.title &&
    (e.location ?? null) === p.location &&
    (e.notes ?? null) === p.notes
  );
}

/**
 * Дифф между уже импортированными событиями группы и свежими данными API.
 * Пользовательские события (source='manual') не трогаются никогда.
 */
export function computeSyncDiff(
  existingImported: CalendarEvent[],
  incoming: ParsedLesson[]
): SyncDiff {
  const byRef = new Map(existingImported.map((e) => [e.sourceRef ?? '', e]));
  const incomingRefs = new Set(incoming.map((p) => p.ref));

  const insert: ParsedLesson[] = [];
  const update: SyncDiff['update'] = [];
  let unchanged = 0;

  for (const lesson of incoming) {
    const existing = byRef.get(lesson.ref);
    if (!existing) {
      insert.push(lesson);
    } else if (sameContent(existing, lesson)) {
      unchanged += 1;
    } else {
      update.push({ event: existing, next: lesson });
    }
  }
  const remove = existingImported.filter((e) => e.sourceRef != null && !incomingRefs.has(e.sourceRef));
  return { insert, update, remove, unchanged };
}
