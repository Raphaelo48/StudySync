/**
 * Валидация пользовательского ввода и внешних данных (импорт).
 *
 * Все сообщения об ошибках — на русском языке, понятные пользователю.
 * Возвращаемый тип Result содержит либо значение, либо карту ошибок по полям.
 */
import { z } from 'zod';
import type { GoalInput } from '../db/repos/goalsRepo';
import type { SubjectInput } from '../db/repos/subjectsRepo';
import type { TaskInput } from '../db/repos/tasksRepo';
import type { EventInput } from '../db/repos/eventsRepo';
import type { UserSettings } from '../models/types';

export type FieldErrors = Record<string, string>;

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldErrors };

function fail(errors: FieldErrors): { ok: false; errors: FieldErrors } {
  return { ok: false, errors };
}

function zodIssuesToFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/* ---------------------------------- Предмет ---------------------------------- */

export const MAX_NAME_LENGTH = 80;
export const MAX_TEXT_LENGTH = 2000;

export function validateSubject(
  raw: Partial<SubjectInput> & { name?: string },
  opts: { now?: number } = {}
): Result<SubjectInput> {
  void opts;
  const errors: FieldErrors = {};
  const name = (raw.name ?? '').trim();
  if (name.length === 0) errors.name = 'Введите название предмета';
  else if (name.length > MAX_NAME_LENGTH) errors.name = `Название не длиннее ${MAX_NAME_LENGTH} символов`;
  const color = raw.color ?? '#7C6CF0';
  if (!/^#[0-9A-Fa-f]{6}$/.test(color)) errors.color = 'Некорректный цвет';
  const description = raw.description ?? null;
  if (description && description.length > MAX_TEXT_LENGTH) errors.description = 'Слишком длинное описание';
  if (Object.keys(errors).length > 0) return fail(errors);
  return {
    ok: true,
    value: {
      name,
      color,
      description: description ?? null,
      targetGrade: raw.targetGrade ?? null,
      note: raw.note ?? null,
    },
  };
}

/* ---------------------------------- Задача ---------------------------------- */

export interface TaskFormValues {
  title?: string;
  description?: string | null;
  subjectId?: string | null;
  hasDeadline?: boolean;
  deadlineAt?: number | null;
  plannedMinutes?: number;
  difficulty?: 1 | 2 | 3;
  priority?: 1 | 2 | 3;
}

export function validateTaskForm(
  raw: TaskFormValues,
  opts: { now?: number; allowPastDeadline?: boolean } = {}
): Result<TaskInput> {
  const now = opts.now ?? Date.now();
  const errors: FieldErrors = {};
  const title = (raw.title ?? '').trim();
  if (title.length === 0) errors.title = 'Введите название задачи';
  else if (title.length > 120) errors.title = 'Название не длиннее 120 символов';

  let plannedMinutes = raw.plannedMinutes ?? 30;
  if (!Number.isFinite(plannedMinutes) || plannedMinutes <= 0) {
    errors.plannedMinutes = 'Длительность должна быть больше нуля';
  } else if (plannedMinutes > 24 * 60) {
    errors.plannedMinutes = 'Длительность не может превышать 24 часа';
  } else {
    plannedMinutes = Math.round(plannedMinutes);
  }

  let deadlineAt: number | null = null;
  if (raw.hasDeadline && raw.deadlineAt != null) {
    if (!Number.isFinite(raw.deadlineAt) || raw.deadlineAt <= 0) {
      errors.deadlineAt = 'Некорректная дата дедлайна';
    } else {
      deadlineAt = raw.deadlineAt;
      if (!opts.allowPastDeadline && deadlineAt < now) {
        errors.deadlineAt = 'Дедлайн не может быть в прошлом';
      }
    }
  }

  const difficulty = raw.difficulty ?? 2;
  if (![1, 2, 3].includes(difficulty)) errors.difficulty = 'Некорректная сложность';
  const priority = raw.priority ?? 2;
  if (![1, 2, 3].includes(priority)) errors.priority = 'Некорректный приоритет';

  if (Object.keys(errors).length > 0) return fail(errors);
  return {
    ok: true,
    value: {
      title,
      description: raw.description ?? null,
      subjectId: raw.subjectId ?? null,
      deadlineAt,
      plannedMinutes,
      difficulty: difficulty as 1 | 2 | 3,
      priority: priority as 1 | 2 | 3,
    },
  };
}

/* ---------------------------------- Событие ---------------------------------- */

export interface EventFormValues {
  title?: string;
  kind?: 'lesson' | 'personal' | 'study';
  subjectId?: string | null;
  location?: string | null;
  startAt?: number;
  endAt?: number;
  notes?: string | null;
  notifyOffsetMinutes?: number | null;
}

export function validateEventForm(raw: EventFormValues): Result<Omit<EventInput, 'startAt' | 'endAt'> & { startAt: number; endAt: number }> {
  const errors: FieldErrors = {};
  const title = (raw.title ?? '').trim();
  if (title.length === 0) errors.title = 'Введите название события';
  else if (title.length > 120) errors.title = 'Название не длиннее 120 символов';

  const startAt = raw.startAt;
  const endAt = raw.endAt;
  if (startAt == null || !Number.isFinite(startAt)) errors.startAt = 'Укажите дату и время начала';
  if (endAt == null || !Number.isFinite(endAt)) errors.endAt = 'Укажите дату и время окончания';
  if (startAt != null && endAt != null && Number.isFinite(startAt) && Number.isFinite(endAt)) {
    if (endAt <= startAt) errors.endAt = 'Окончание должно быть позже начала';
    else if (endAt - startAt > 24 * 3600_000) errors.endAt = 'Событие не может длиться больше суток';
  }
  const offset = raw.notifyOffsetMinutes ?? null;
  if (offset != null && (!Number.isFinite(offset) || offset < 0 || offset > 7 * 24 * 60)) {
    errors.notifyOffsetMinutes = 'Некорректное время напоминания';
  }
  if (Object.keys(errors).length > 0) return fail(errors);
  return {
    ok: true,
    value: {
      title,
      kind: raw.kind ?? 'lesson',
      subjectId: raw.subjectId ?? null,
      location: raw.location ?? null,
      startAt: startAt as number,
      endAt: endAt as number,
      notes: raw.notes ?? null,
      notifyOffsetMinutes: offset,
    },
  };
}

/* ---------------------------------- Цель ---------------------------------- */

export function validateGoalForm(
  raw: Partial<GoalInput> & { metric?: string; period?: string }
): Result<GoalInput> {
  const errors: FieldErrors = {};
  const metric = raw.metric;
  if (metric !== 'study_minutes' && metric !== 'completed_tasks') {
    errors.metric = 'Выберите показатель цели';
  }
  const period = raw.period;
  if (period !== 'week' && period !== 'month' && period !== 'semester') {
    errors.period = 'Выберите период цели';
  }
  const targetValue = raw.targetValue ?? 0;
  if (!Number.isFinite(targetValue) || targetValue <= 0) {
    errors.targetValue = 'Целевое значение должно быть больше нуля';
  } else if (targetValue > 100000) {
    errors.targetValue = 'Слишком большое целевое значение';
  }
  if (period === 'semester') {
    const s = raw.periodStartAt;
    const e = raw.periodEndAt;
    if (s == null || e == null) {
      errors.periodStartAt = 'Для цели на семестр укажите даты начала и окончания';
    } else if (e <= s) {
      errors.periodEndAt = 'Окончание семестра должно быть позже начала';
    }
  }
  if (Object.keys(errors).length > 0) return fail(errors);
  return {
    ok: true,
    value: {
      subjectId: raw.subjectId ?? null,
      metric: metric as 'study_minutes' | 'completed_tasks',
      targetValue,
      period: period as 'week' | 'month' | 'semester',
      periodStartAt: raw.periodStartAt ?? null,
      periodEndAt: raw.periodEndAt ?? null,
      note: raw.note ?? null,
    },
  };
}

/* ---------------------------------- Настройки ---------------------------------- */

export type SettingsPatch = Partial<Omit<UserSettings, 'createdAt' | 'updatedAt'>>;

export function validateSettingsPatch(patch: SettingsPatch, current: UserSettings): Result<SettingsPatch> {
  const errors: FieldErrors = {};
  const next = { ...current, ...patch };
  if (next.displayName.length > 60) errors.displayName = 'Имя не длиннее 60 символов';
  const intRange = (key: keyof SettingsPatch, value: number | undefined, min: number, max: number, label: string) => {
    if (value === undefined) return;
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
      errors[key] = `${label}: допустимые значения ${min}–${max}`;
    }
  };
  intRange('defaultWorkMin', patch.defaultWorkMin, 1, 180, 'Длительность работы');
  intRange('defaultBreakMin', patch.defaultBreakMin, 1, 60, 'Перерыв');
  intRange('defaultLongBreakMin', patch.defaultLongBreakMin, 1, 120, 'Длинный перерыв');
  intRange('cyclesBeforeLongBreak', patch.cyclesBeforeLongBreak, 1, 12, 'Циклов до длинного перерыва');
  intRange('dailyGoalMin', patch.dailyGoalMin, 0, 16 * 60, 'Дневная цель');
  intRange('notifyLessonBeforeMin', patch.notifyLessonBeforeMin, 0, 24 * 60, 'Напоминание о занятии');
  intRange('notifyDeadlineBeforeMin', patch.notifyDeadlineBeforeMin, 0, 7 * 24 * 60, 'Напоминание о дедлайне');
  intRange('breakBetweenTasksMin', patch.breakBetweenTasksMin, 0, 60, 'Пауза между задачами');
  intRange('planningHorizonDays', patch.planningHorizonDays, 1, 60, 'Горизонт планирования');
  intRange('studyWindowStartMin', patch.studyWindowStartMin, 0, 1439, 'Начало учебного окна');
  intRange('studyWindowEndMin', patch.studyWindowEndMin, 0, 1439, 'Конец учебного окна');
  intRange('morningDigestTimeMin', patch.morningDigestTimeMin, 0, 1439, 'Время утренней сводки');
  if (next.studyWindowEndMin <= next.studyWindowStartMin) {
    errors.studyWindowEndMin = 'Конец учебного окна должен быть позже начала';
  }
  if (!['light', 'dark', 'system'].includes(next.themeMode)) errors.themeMode = 'Некорректная тема';
  if (![0, 1].includes(next.weekStart)) errors.weekStart = 'Некорректный день начала недели';
  if (Object.keys(errors).length > 0) return fail(errors);
  return { ok: true, value: patch };
}

/** Проверка произвольной строки короткого текста (подзадачи и т.п.). */
export function validateShortText(value: string, fieldLabel: string, maxLength = 120): Result<string> {
  const trimmed = value.trim();
  if (trimmed.length === 0) return fail({ value: `Введите ${fieldLabel.toLowerCase()}` });
  if (trimmed.length > maxLength) return fail({ value: `Не длиннее ${maxLength} символов` });
  return { ok: true, value: trimmed };
}

export { zodIssuesToFieldErrors };
