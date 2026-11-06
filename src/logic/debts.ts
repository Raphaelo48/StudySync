/**
 * Долги и отработки: чек-листы по умолчанию, подписи попыток, подсказка
 * преподавателя из расписания КГЭУ.
 */
import type { AppDatabase } from '../db/database';
import { DAY_MS, startOfDay } from '../core/time';
import type { ChecklistItem, DebtKind, ID } from '../models/types';
import { describeEvent } from './eventDisplay';

/** Что обычно нужно взять с собой — стартовый чек-лист, его можно править. */
export const DEFAULT_CHECKLIST: Record<DebtKind, string[]> = {
  lab: ['Отчёт распечатан', 'Допуск получен', 'Повторить теорию к защите'],
  credit: ['Зачётка', 'Вопросы к зачёту повторены'],
  exam: ['Зачётка', 'Направление на пересдачу из деканата', 'Билеты повторены'],
  absence: ['Конспект пропущенной темы', 'Справка (если есть)', 'Задание на отработку выполнено'],
  coursework: ['Работа распечатана и сшита', 'Подпись руководителя', 'Доклад и презентация'],
  other: [],
};

export function defaultChecklist(kind: DebtKind): ChecklistItem[] {
  return DEFAULT_CHECKLIST[kind].map((text) => ({ text, done: false }));
}

/** «Первая сдача», «Пересдача», «2-я пересдача (комиссия)». */
export function attemptLabel(attempt: number): string | null {
  if (attempt <= 1) return null;
  if (attempt === 2) return 'Пересдача';
  if (attempt === 3) return '2-я пересдача · комиссия';
  return `Пересдача №${attempt - 1}`;
}

/** Короткая подпись срока: «сегодня», «завтра», «через 3 дн.», «просрочено». */
export function retakeWhenLabel(retakeAt: number, now: number = Date.now()): string {
  const days = Math.round((startOfDay(retakeAt) - startOfDay(now)) / DAY_MS);
  if (retakeAt < now && days <= 0) return days === 0 ? 'сегодня, время прошло' : 'дата прошла';
  if (days === 0) return 'сегодня';
  if (days === 1) return 'завтра';
  return `через ${days} дн.`;
}

export function checklistProgress(items: ChecklistItem[]): { done: number; total: number } {
  return { done: items.filter((i) => i.done).length, total: items.length };
}

/**
 * Преподаватель по предмету — из последних импортированных пар этого предмета.
 * Если у предмета несколько преподавателей (лекции и практики), берём того,
 * кто ведёт практику/лабы: именно ему обычно сдают долги.
 */
export async function suggestTeacher(db: AppDatabase, subjectId: ID, now: number = Date.now()): Promise<string | null> {
  const events = await db.events.listRange(now - 120 * DAY_MS, now + 60 * DAY_MS);
  const candidates = events
    .filter((e) => e.subjectId === subjectId && e.kind === 'lesson')
    .map((e) => describeEvent(e))
    .filter((d) => d.teacher);
  if (candidates.length === 0) return null;
  const practical = candidates.find((d) => d.kindLabel && d.kindLabel !== 'Лекция');
  return (practical ?? candidates[candidates.length - 1]!).teacher;
}
