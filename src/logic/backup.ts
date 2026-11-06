/**
 * Экспорт и импорт данных StudySync.
 *
 * ## Формат резервной копии (JSON)
 * {
 *   "format": "studysync-backup",
 *   "formatVersion": 1,
 *   "exportedAt": <epoch ms>,
 *   "appVersion": "1.0.0",
 *   "data": {
 *     "subjects":      [ { id, name, description, color, targetGrade, note, archived, createdAt, updatedAt } ],
 *     "tasks":         [ { id, title, description, subjectId, deadlineAt, plannedMinutes, difficulty,
 *                          priority, status, createdAt, updatedAt, completedAt, actualMinutes,
 *                          deferCount, scheduledStartAt, scheduledEndAt } ],
 *     "subtasks":      [ { id, taskId, title, done, position, createdAt } ],
 *     "events":        [ { id, title, kind, subjectId, taskId, location, startAt, endAt, notes,
 *                          seriesId, recurrence, notifyOffsetMinutes, createdAt, updatedAt } ],
 *     "studySessions": [ { id, taskId, subjectId, startedAt, endedAt, activeSeconds, breakSeconds,
 *                          mode, completed, notes } ],
 *     "goals":         [ { id, subjectId, metric, targetValue, period, periodStartAt, periodEndAt,
 *                          note, createdAt } ],
 *     "settings":      { ...UserSettings },
 *     "debts":         [ { id, subjectId, title, kind, teacher, attempt, retakeAt, location,
 *                          checklist: [{ text, done }], status, notes, createdAt, updatedAt, passedAt } ],
 *     "lessonNotes":   [ { id, subjectId, lessonKey, lessonTitle, lessonStartAt, text, important,
 *                          photos: [имя файла], createdAt, updatedAt } ],
 *     "lessonPhotos":  [ { name, base64 } ]   // только если при экспорте выбрано «с фото»
 *   }
 * }
 *
 * Все временные значения — целые числа, миллисекунды с эпохи Unix.
 * Неизвестные поля при импорте игнорируются; отсутствующие необязательные
 * поля получают значения по умолчанию; некорректные обязательные поля —
 * ошибка импорта с указанием пути.
 *
 * ## Безопасность
 * - Импорт выполняется в одной транзакции: любая ошибка → полный откат,
 *   исходные данные остаются целыми.
 * - Перед разрушительным импортом (replace) и перед сбросом данных создаётся
 *   внутренняя резервная копия (таблица data_backups).
 * - Merge-режим не перезаписывает существующие записи: совпавшие id считаются
 *   дубликатами и пропускаются (попадают в отчёт).
 * - Ссылки на отсутствующие записи (например, subjectId удалённого предмета)
 *   заменяются на null с предупреждением в отчёте.
 */
import { z } from 'zod';
import { newId } from '../core/id';
import type { AppDatabase } from '../db/database';
import { toInt } from '../db/mappers';
import { DEFAULT_SETTINGS, IDLE_TIMER_STATE } from '../models/types';
import type { RecurrenceRule } from '../models/types';

export const BACKUP_FORMAT = 'studysync-backup';
export const BACKUP_FORMAT_VERSION = 4; // v4: + долги, конспекты к парам, сроки этапов, утренняя сводка
export const APP_VERSION = '1.0.0';

/* ---------------------------------- Zod-схемы ---------------------------------- */

const idSchema = z.string().min(1, 'пустой идентификатор').max(64);
const tsSchema = z.number().int('ожидается целое число').positive('ожидается положительная метка времени');
const tsOrNull = tsSchema.nullable();
const strOrNull = z.string().nullable();

const subjectSchema = z.object({
  id: idSchema,
  source: z.enum(['manual', 'moodle']).optional(),
  sourceRef: z.string().max(200).nullable().optional(),
  name: z.string().min(1, 'название предмета обязательно').max(200),
  description: strOrNull.optional().nullable(),
  color: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/, 'некорректный цвет (ожидается #RRGGBB)')
    .optional(),
  targetGrade: strOrNull.optional().nullable(),
  note: strOrNull.optional().nullable(),
  archived: z.boolean().optional(),
  createdAt: tsSchema,
  updatedAt: tsSchema,
});

const taskSchema = z.object({
  id: idSchema,
  source: z.enum(['manual', 'moodle']).optional(),
  sourceRef: z.string().max(200).nullable().optional(),
  title: z.string().min(1, 'название задачи обязательно').max(300),
  description: strOrNull.optional().nullable(),
  subjectId: z.string().max(64).nullable().optional(),
  deadlineAt: tsOrNull.optional().nullable(),
  plannedMinutes: z.number().int().min(1).max(24 * 60),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  status: z.enum(['planned', 'in_progress', 'done', 'deferred']).optional(),
  createdAt: tsSchema,
  updatedAt: tsSchema,
  completedAt: tsOrNull.optional().nullable(),
  actualMinutes: z.number().int().min(0).optional(),
  deferCount: z.number().int().min(0).optional(),
  scheduledStartAt: tsOrNull.optional().nullable(),
  scheduledEndAt: tsOrNull.optional().nullable(),
});

const subtaskSchema = z.object({
  id: idSchema,
  taskId: idSchema,
  title: z.string().min(1).max(300),
  done: z.boolean().optional(),
  position: z.number().int().min(0).optional(),
  dueAt: tsOrNull.optional(),
  createdAt: tsSchema,
});

const debtSchema = z.object({
  id: idSchema,
  subjectId: idSchema.nullable().optional(),
  title: z.string().min(1).max(200),
  kind: z.enum(['lab', 'credit', 'exam', 'absence', 'coursework', 'other']).optional(),
  teacher: strOrNull.optional(),
  attempt: z.number().int().min(1).max(10).optional(),
  retakeAt: tsOrNull.optional(),
  location: strOrNull.optional(),
  checklist: z.array(z.object({ text: z.string().min(1).max(200), done: z.boolean() })).max(50).optional(),
  status: z.enum(['open', 'scheduled', 'passed']).optional(),
  notes: strOrNull.optional(),
  createdAt: tsSchema,
  updatedAt: tsSchema,
  passedAt: tsOrNull.optional(),
});

const photoNameSchema = z.string().regex(/^[A-Za-z0-9._-]{1,100}$/, 'некорректное имя файла фото');

const lessonNoteSchema = z.object({
  id: idSchema,
  subjectId: idSchema.nullable().optional(),
  lessonKey: z.string().min(1).max(300),
  lessonTitle: z.string().min(1).max(300),
  lessonStartAt: tsSchema,
  text: z.string().max(20000).optional(),
  important: z.boolean().optional(),
  photos: z.array(photoNameSchema).max(50).optional(),
  createdAt: tsSchema,
  updatedAt: tsSchema,
});

const lessonPhotoSchema = z.object({
  name: photoNameSchema,
  base64: z.string().min(1),
});

const recurrenceSchema = z
  .object({
    freq: z.enum(['daily', 'weekly']),
    daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
    until: tsOrNull.optional().nullable(),
    count: z.number().int().positive().optional().nullable(),
  })
  .nullable();

const eventSchema = z.object({
  id: idSchema,
  title: z.string().min(1, 'название события обязательно').max(300),
  kind: z.enum(['lesson', 'personal', 'study']).optional(),
  subjectId: z.string().max(64).nullable().optional(),
  taskId: z.string().max(64).nullable().optional(),
  location: strOrNull.optional().nullable(),
  startAt: tsSchema,
  endAt: tsSchema,
  notes: strOrNull.optional().nullable(),
  seriesId: z.string().max(64).nullable().optional(),
  recurrence: recurrenceSchema.optional().nullable(),
  notifyOffsetMinutes: z.number().int().min(0).max(7 * 24 * 60).nullable().optional(),
  source: z.enum(['manual', 'kgeu', 'moodle']).optional(),
  sourceRef: z.string().max(200).nullable().optional(),
  createdAt: tsSchema,
  updatedAt: tsSchema,
});

const studySessionSchema = z.object({
  id: idSchema,
  taskId: z.string().max(64).nullable().optional(),
  subjectId: z.string().max(64).nullable().optional(),
  startedAt: tsSchema,
  endedAt: tsSchema,
  activeSeconds: z.number().int().min(1, 'активное время должно быть положительным'),
  breakSeconds: z.number().int().min(0).optional(),
  mode: z.enum(['pomodoro', 'stopwatch']).optional(),
  completed: z.boolean().optional(),
  notes: strOrNull.optional().nullable(),
});

const goalSchema = z.object({
  id: idSchema,
  subjectId: z.string().max(64).nullable().optional(),
  metric: z.enum(['study_minutes', 'completed_tasks']),
  targetValue: z.number().positive(),
  period: z.enum(['week', 'month', 'semester']),
  periodStartAt: tsOrNull.optional().nullable(),
  periodEndAt: tsOrNull.optional().nullable(),
  note: strOrNull.optional().nullable(),
  createdAt: tsSchema,
});

const settingsSchema = z.object({
  displayName: z.string().max(60).optional(),
  themeMode: z.enum(['light', 'dark', 'system']).optional(),
  weekStart: z.union([z.literal(0), z.literal(1)]).optional(),
  notificationsEnabled: z.boolean().optional(),
  notifyLesson: z.boolean().optional(),
  notifyLessonBeforeMin: z.number().int().min(0).max(24 * 60).optional(),
  notifyDeadline: z.boolean().optional(),
  notifyDeadlineBeforeMin: z.number().int().min(0).max(7 * 24 * 60).optional(),
  notifySession: z.boolean().optional(),
  notifyBreak: z.boolean().optional(),
  defaultWorkMin: z.number().int().min(1).max(180).optional(),
  defaultBreakMin: z.number().int().min(1).max(60).optional(),
  defaultLongBreakMin: z.number().int().min(1).max(120).optional(),
  cyclesBeforeLongBreak: z.number().int().min(1).max(12).optional(),
  dailyGoalMin: z.number().int().min(0).max(16 * 60).optional(),
  studyWindowStartMin: z.number().int().min(0).max(1439).optional(),
  studyWindowEndMin: z.number().int().min(0).max(1439).optional(),
  breakBetweenTasksMin: z.number().int().min(0).max(60).optional(),
  planningHorizonDays: z.number().int().min(1).max(60).optional(),
  onboardingDone: z.boolean().optional(),
  morningDigestEnabled: z.boolean().optional(),
  morningDigestTimeMin: z.number().int().min(0).max(1439).optional(),
  createdAt: tsSchema.optional(),
  updatedAt: tsSchema.optional(),
});

const backupSchema = z.object({
  format: z.literal(BACKUP_FORMAT, 'файл не является резервной копией StudySync'),
  formatVersion: z.number().int('некорректная версия формата'),
  exportedAt: tsSchema,
  appVersion: z.string().optional(),
  data: z.object({
    subjects: z.array(subjectSchema).default([]),
    tasks: z.array(taskSchema).default([]),
    subtasks: z.array(subtaskSchema).default([]),
    events: z.array(eventSchema).default([]),
    studySessions: z.array(studySessionSchema).default([]),
    goals: z.array(goalSchema).default([]),
    settings: settingsSchema.nullable().optional(),
    debts: z.array(debtSchema).optional(),
    lessonNotes: z.array(lessonNoteSchema).optional(),
    lessonPhotos: z.array(lessonPhotoSchema).optional(),
  }),
});

export type BackupFile = z.infer<typeof backupSchema>;
export type BackupSubject = z.infer<typeof subjectSchema>;
export type BackupTask = z.infer<typeof taskSchema>;
export type BackupSubtask = z.infer<typeof subtaskSchema>;
export type BackupEvent = z.infer<typeof eventSchema>;
export type BackupSession = z.infer<typeof studySessionSchema>;
export type BackupGoal = z.infer<typeof goalSchema>;

/* ---------------------------------- Ошибки ---------------------------------- */

export class BackupParseError extends Error {
  constructor(message: string, public readonly issues: string[] = []) {
    super(message);
    this.name = 'BackupParseError';
  }
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

/* ---------------------------------- Парсинг ---------------------------------- */

export function parseBackup(raw: string): BackupFile {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new BackupParseError('Файл не является корректным JSON');
  }
  const result = backupSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 10)
      .map((i) => `${i.path.join('.') || 'корень'}: ${i.message}`);
    throw new BackupParseError('Файл не соответствует формату резервной копии StudySync', issues);
  }
  if (result.data.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new BackupParseError(
      `Файл создан более новой версией приложения (формат v${result.data.formatVersion}, поддерживается v${BACKUP_FORMAT_VERSION})`
    );
  }
  if (result.data.formatVersion < 1) {
    throw new BackupParseError(`Неподдерживаемая версия формата: ${result.data.formatVersion}`);
  }
  // Межполевые проверки
  for (const ev of result.data.data.events) {
    if (ev.endAt <= ev.startAt) {
      throw new BackupParseError('Некорректное событие в файле: окончание раньше начала', [
        `events(${ev.id}): endAt <= startAt`,
      ]);
    }
  }
  for (const s of result.data.data.studySessions) {
    if (s.endedAt < s.startedAt) {
      throw new BackupParseError('Некорректная учебная сессия в файле', [
        `studySessions(${s.id}): endedAt < startedAt`,
      ]);
    }
  }
  return result.data;
}

/* ---------------------------------- Экспорт ---------------------------------- */

export async function exportAll(db: AppDatabase, now: number = Date.now()): Promise<BackupFile> {
  const driver = db.driver;
  const subjects = await driver.getAll<Record<string, unknown>>('SELECT * FROM subjects');
  const tasks = await driver.getAll<Record<string, unknown>>('SELECT * FROM tasks');
  const subtasks = await driver.getAll<Record<string, unknown>>('SELECT * FROM subtasks');
  const events = await driver.getAll<Record<string, unknown>>('SELECT * FROM events');
  const sessions = await driver.getAll<Record<string, unknown>>('SELECT * FROM study_sessions');
  const goals = await driver.getAll<Record<string, unknown>>('SELECT * FROM goals');
  const debts = await driver.getAll<Record<string, unknown>>('SELECT * FROM debts');
  const lessonNotes = await driver.getAll<Record<string, unknown>>('SELECT * FROM lesson_notes');
  const settings = await db.settings.get();
  const parseJsonArray = <T,>(raw: unknown): T[] => {
    if (typeof raw !== 'string') return [];
    try {
      const v = JSON.parse(raw) as unknown;
      return Array.isArray(v) ? (v as T[]) : [];
    } catch {
      return [];
    }
  };

  const mapSubjectRow = (r: Record<string, unknown>) => ({
    id: r.id as string,
    source: ((r.source as string | null) ?? 'manual') as 'manual' | 'moodle',
    sourceRef: (r.source_ref as string | null) ?? null,
    name: r.name as string,
    description: (r.description as string | null) ?? null,
    color: (r.color as string) ?? '#7C6CF0',
    targetGrade: (r.target_grade as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    archived: r.archived === 1,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  });
  const mapTaskRow = (r: Record<string, unknown>) => ({
    id: r.id as string,
    source: ((r.source as string | null) ?? 'manual') as 'manual' | 'moodle',
    sourceRef: (r.source_ref as string | null) ?? null,
    title: r.title as string,
    description: (r.description as string | null) ?? null,
    subjectId: (r.subject_id as string | null) ?? null,
    deadlineAt: (r.deadline_at as number | null) ?? null,
    plannedMinutes: r.planned_minutes as number,
    difficulty: r.difficulty as 1 | 2 | 3,
    priority: r.priority as 1 | 2 | 3,
    status: r.status as 'planned' | 'in_progress' | 'done' | 'deferred',
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    completedAt: (r.completed_at as number | null) ?? null,
    actualMinutes: (r.actual_minutes as number) ?? 0,
    deferCount: (r.defer_count as number) ?? 0,
    scheduledStartAt: (r.scheduled_start_at as number | null) ?? null,
    scheduledEndAt: (r.scheduled_end_at as number | null) ?? null,
  });
  const mapSubtaskRow = (r: Record<string, unknown>) => ({
    id: r.id as string,
    taskId: r.task_id as string,
    title: r.title as string,
    done: r.done === 1,
    position: (r.position as number) ?? 0,
    dueAt: (r.due_at as number | null) ?? null,
    createdAt: r.created_at as number,
  });
  const mapDebtRow = (r: Record<string, unknown>) => ({
    id: r.id as string,
    subjectId: (r.subject_id as string | null) ?? null,
    title: r.title as string,
    kind: r.kind as 'lab' | 'credit' | 'exam' | 'absence' | 'coursework' | 'other',
    teacher: (r.teacher as string | null) ?? null,
    attempt: (r.attempt as number) ?? 1,
    retakeAt: (r.retake_at as number | null) ?? null,
    location: (r.location as string | null) ?? null,
    checklist: parseJsonArray<{ text: string; done: boolean }>(r.checklist_json),
    status: r.status as 'open' | 'scheduled' | 'passed',
    notes: (r.notes as string | null) ?? null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    passedAt: (r.passed_at as number | null) ?? null,
  });
  const mapLessonNoteRow = (r: Record<string, unknown>) => ({
    id: r.id as string,
    subjectId: (r.subject_id as string | null) ?? null,
    lessonKey: r.lesson_key as string,
    lessonTitle: r.lesson_title as string,
    lessonStartAt: r.lesson_start_at as number,
    text: (r.text as string) ?? '',
    important: r.important === 1,
    photos: parseJsonArray<string>(r.photos_json),
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  });
  const mapEventRow = (r: Record<string, unknown>) => {
    let recurrence: RecurrenceRule | null = null;
    const raw = r.recurrence_json as string | null;
    if (raw) {
      try {
        recurrence = JSON.parse(raw) as RecurrenceRule;
      } catch {
        recurrence = null;
      }
    }
    return {
      id: r.id as string,
      title: r.title as string,
      kind: (r.kind as 'lesson' | 'personal' | 'study') ?? 'lesson',
      subjectId: (r.subject_id as string | null) ?? null,
      taskId: (r.task_id as string | null) ?? null,
      location: (r.location as string | null) ?? null,
      startAt: r.start_at as number,
      endAt: r.end_at as number,
      notes: (r.notes as string | null) ?? null,
      seriesId: (r.series_id as string | null) ?? null,
      recurrence,
      notifyOffsetMinutes: (r.notify_offset_minutes as number | null) ?? null,
      source: ((r.source as string | null) ?? 'manual') as 'manual' | 'kgeu' | 'moodle',
      sourceRef: (r.source_ref as string | null) ?? null,
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
    };
  };
  const mapSessionRow = (r: Record<string, unknown>) => ({
    id: r.id as string,
    taskId: (r.task_id as string | null) ?? null,
    subjectId: (r.subject_id as string | null) ?? null,
    startedAt: r.started_at as number,
    endedAt: r.ended_at as number,
    activeSeconds: r.active_seconds as number,
    breakSeconds: (r.break_seconds as number) ?? 0,
    mode: (r.mode as 'pomodoro' | 'stopwatch') ?? 'pomodoro',
    completed: r.completed === 1,
    notes: (r.notes as string | null) ?? null,
  });
  const mapGoalRow = (r: Record<string, unknown>) => ({
    id: r.id as string,
    subjectId: (r.subject_id as string | null) ?? null,
    metric: r.metric as 'study_minutes' | 'completed_tasks',
    targetValue: r.target_value as number,
    period: r.period as 'week' | 'month' | 'semester',
    periodStartAt: (r.period_start_at as number | null) ?? null,
    periodEndAt: (r.period_end_at as number | null) ?? null,
    note: (r.note as string | null) ?? null,
    createdAt: r.created_at as number,
  });

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: now,
    appVersion: APP_VERSION,
    data: {
      subjects: subjects.map(mapSubjectRow),
      tasks: tasks.map(mapTaskRow),
      subtasks: subtasks.map(mapSubtaskRow),
      events: events.map(mapEventRow),
      studySessions: sessions.map(mapSessionRow),
      goals: goals.map(mapGoalRow),
      settings: { ...settings },
      debts: debts.map(mapDebtRow),
      lessonNotes: lessonNotes.map(mapLessonNoteRow),
    },
  };
}

export function serializeBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2);
}

/* ---------------------------------- Импорт ---------------------------------- */

export type ImportMode = 'merge' | 'replace';

export interface ImportReport {
  mode: ImportMode;
  inserted: {
    subjects: number;
    tasks: number;
    subtasks: number;
    events: number;
    studySessions: number;
    goals: number;
    debts: number;
    lessonNotes: number;
  };
  duplicatesSkipped: number;
  settingsReplaced: boolean;
  warnings: string[];
  internalBackupId: string | null;
}

async function exists(driver: AppDatabase['driver'], table: string, id: string): Promise<boolean> {
  const row = await driver.getFirst<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE id = ?`, [id]);
  return (row?.n ?? 0) > 0;
}

/**
 * Импортировать резервную копию. Всё выполняется в одной транзакции:
 * при любой ошибке БД остаётся в исходном состоянии.
 */
export async function importBackup(
  db: AppDatabase,
  backup: BackupFile,
  mode: ImportMode,
  now: number = Date.now()
): Promise<ImportReport> {
  const warnings: string[] = [];

  // Внутренняя резервная копия перед потенциально разрушительным импортом.
  let internalBackupId: string | null = null;
  const snapshot = await exportAll(db, now);
  internalBackupId = await saveInternalBackup(db, snapshot, `auto-before-import-${mode}`, now);

  const report: ImportReport = {
    mode,
    inserted: { subjects: 0, tasks: 0, subtasks: 0, events: 0, studySessions: 0, goals: 0, debts: 0, lessonNotes: 0 },
    duplicatesSkipped: 0,
    settingsReplaced: false,
    warnings,
    internalBackupId,
  };

  await db.driver.transaction(async () => {
    if (mode === 'replace') {
      // Порядок удаления учитывает внешние ключи.
      await db.driver.exec('DELETE FROM subtasks');
      await db.driver.exec('DELETE FROM events');
      await db.driver.exec('DELETE FROM study_sessions');
      await db.driver.exec('DELETE FROM tasks');
      await db.driver.exec('DELETE FROM goals');
      await db.driver.exec('DELETE FROM debts');
      await db.driver.exec('DELETE FROM lesson_notes');
      await db.driver.exec('DELETE FROM subjects');
    }

    const knownSubjects = new Set<string>(
      mode === 'replace'
        ? []
        : (await db.driver.getAll<{ id: string }>('SELECT id FROM subjects')).map((r) => r.id)
    );
    for (const s of backup.data.subjects) knownSubjects.add(s.id);
    const knownTasks = new Set<string>(
      mode === 'replace'
        ? []
        : (await db.driver.getAll<{ id: string }>('SELECT id FROM tasks')).map((r) => r.id)
    );
    for (const t of backup.data.tasks) knownTasks.add(t.id);

    const fixSubjectRef = (subjectId: string | null | undefined, ctx: string): string | null => {
      if (subjectId == null) return null;
      if (knownSubjects.has(subjectId)) return subjectId;
      warnings.push(`${ctx}: ссылка на несуществующий предмет ${subjectId} заменена на «без предмета»`);
      return null;
    };
    const fixTaskRef = (taskId: string | null | undefined, ctx: string): string | null => {
      if (taskId == null) return null;
      if (knownTasks.has(taskId)) return taskId;
      warnings.push(`${ctx}: ссылка на несуществующую задачу ${taskId} удалена`);
      return null;
    };

    for (const s of backup.data.subjects) {
      if (mode === 'merge' && (await exists(db.driver, 'subjects', s.id))) {
        report.duplicatesSkipped += 1;
        continue;
      }
      await db.driver.run(
        `INSERT INTO subjects (id, source, source_ref, name, description, color, target_grade, note, archived, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          s.id, s.source ?? 'manual', s.sourceRef ?? null, s.name, s.description ?? null,
          s.color ?? '#7C6CF0', s.targetGrade ?? null,
          s.note ?? null, toInt(s.archived ?? false), s.createdAt, s.updatedAt,
        ]
      );
      report.inserted.subjects += 1;
    }

    for (const t of backup.data.tasks) {
      if (mode === 'merge' && (await exists(db.driver, 'tasks', t.id))) {
        report.duplicatesSkipped += 1;
        continue;
      }
      await db.driver.run(
        `INSERT INTO tasks (id, source, source_ref, title, description, subject_id, deadline_at, planned_minutes, difficulty,
          priority, status, created_at, updated_at, completed_at, actual_minutes, defer_count,
          scheduled_start_at, scheduled_end_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          t.id, t.source ?? 'manual', t.sourceRef ?? null, t.title, t.description ?? null, fixSubjectRef(t.subjectId, `tasks(${t.id})`),
          t.deadlineAt ?? null, t.plannedMinutes, t.difficulty ?? 2, t.priority ?? 2,
          t.status ?? 'planned', t.createdAt, t.updatedAt, t.completedAt ?? null,
          t.actualMinutes ?? 0, t.deferCount ?? 0, t.scheduledStartAt ?? null, t.scheduledEndAt ?? null,
        ]
      );
      report.inserted.tasks += 1;
    }

    for (const st of backup.data.subtasks) {
      if (mode === 'merge' && (await exists(db.driver, 'subtasks', st.id))) {
        report.duplicatesSkipped += 1;
        continue;
      }
      const taskId = fixTaskRef(st.taskId, `subtasks(${st.id})`);
      if (taskId == null) continue; // подзадача без задачи не имеет смысла
      await db.driver.run(
        'INSERT INTO subtasks (id, task_id, title, done, position, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [st.id, taskId, st.title, toInt(st.done ?? false), st.position ?? 0, st.dueAt ?? null, st.createdAt]
      );
      report.inserted.subtasks += 1;
    }

    for (const e of backup.data.events) {
      if (mode === 'merge' && (await exists(db.driver, 'events', e.id))) {
        report.duplicatesSkipped += 1;
        continue;
      }
      await db.driver.run(
        `INSERT INTO events (id, title, kind, subject_id, task_id, location, start_at, end_at, notes,
          series_id, recurrence_json, notify_offset_minutes, source, source_ref, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          e.id, e.title, e.kind ?? 'lesson', fixSubjectRef(e.subjectId, `events(${e.id})`),
          fixTaskRef(e.taskId, `events(${e.id})`), e.location ?? null, e.startAt, e.endAt,
          e.notes ?? null, e.seriesId ?? null,
          e.recurrence ? JSON.stringify(e.recurrence) : null,
          e.notifyOffsetMinutes ?? null, e.source ?? 'manual', e.sourceRef ?? null,
          e.createdAt, e.updatedAt,
        ]
      );
      report.inserted.events += 1;
    }

    for (const s of backup.data.studySessions) {
      if (mode === 'merge' && (await exists(db.driver, 'study_sessions', s.id))) {
        report.duplicatesSkipped += 1;
        continue;
      }
      await db.driver.run(
        `INSERT INTO study_sessions (id, task_id, subject_id, started_at, ended_at, active_seconds,
          break_seconds, mode, completed, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          s.id, fixTaskRef(s.taskId, `studySessions(${s.id})`), fixSubjectRef(s.subjectId, `studySessions(${s.id})`),
          s.startedAt, s.endedAt, s.activeSeconds, s.breakSeconds ?? 0, s.mode ?? 'pomodoro',
          toInt(s.completed ?? false), s.notes ?? null,
        ]
      );
      report.inserted.studySessions += 1;
    }

    for (const g of backup.data.goals) {
      if (mode === 'merge' && (await exists(db.driver, 'goals', g.id))) {
        report.duplicatesSkipped += 1;
        continue;
      }
      const subjectId = fixSubjectRef(g.subjectId, `goals(${g.id})`);
      if (g.subjectId != null && subjectId == null) continue; // цель предмета без предмета некорректна
      await db.driver.run(
        `INSERT INTO goals (id, subject_id, metric, target_value, period, period_start_at, period_end_at, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          g.id, subjectId, g.metric, g.targetValue, g.period,
          g.periodStartAt ?? null, g.periodEndAt ?? null, g.note ?? null, g.createdAt,
        ]
      );
      report.inserted.goals += 1;
    }

    for (const d of backup.data.debts ?? []) {
      if (mode === 'merge' && (await exists(db.driver, 'debts', d.id))) {
        report.duplicatesSkipped += 1;
        continue;
      }
      await db.driver.run(
        `INSERT INTO debts (id, subject_id, title, kind, teacher, attempt, retake_at, location, checklist_json,
          status, notes, created_at, updated_at, passed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          d.id, fixSubjectRef(d.subjectId, `debts(${d.id})`), d.title, d.kind ?? 'other', d.teacher ?? null,
          d.attempt ?? 1, d.retakeAt ?? null, d.location ?? null, JSON.stringify(d.checklist ?? []),
          d.status ?? 'open', d.notes ?? null, d.createdAt, d.updatedAt, d.passedAt ?? null,
        ]
      );
      report.inserted.debts += 1;
    }

    for (const n of backup.data.lessonNotes ?? []) {
      if (mode === 'merge') {
        if (await exists(db.driver, 'lesson_notes', n.id)) {
          report.duplicatesSkipped += 1;
          continue;
        }
        const sameKey = await db.driver.getFirst<{ n: number }>(
          'SELECT COUNT(*) AS n FROM lesson_notes WHERE lesson_key = ?',
          [n.lessonKey]
        );
        if ((sameKey?.n ?? 0) > 0) {
          report.duplicatesSkipped += 1;
          continue;
        }
      }
      await db.driver.run(
        `INSERT INTO lesson_notes (id, subject_id, lesson_key, lesson_title, lesson_start_at, text, important,
          photos_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          n.id, fixSubjectRef(n.subjectId, `lessonNotes(${n.id})`), n.lessonKey, n.lessonTitle, n.lessonStartAt,
          n.text ?? '', toInt(n.important ?? false), JSON.stringify(n.photos ?? []), n.createdAt, n.updatedAt,
        ]
      );
      report.inserted.lessonNotes += 1;
    }

    if (mode === 'replace' && backup.data.settings) {
      await db.settings.replace({
        ...DEFAULT_SETTINGS,
        ...backup.data.settings,
        createdAt: backup.data.settings.createdAt ?? now,
        updatedAt: now,
      });
      report.settingsReplaced = true;
    }

    // Таймер — транзиентное состояние: при replace-импорте сбрасываем.
    if (mode === 'replace') {
      await db.timer.reset({ ...IDLE_TIMER_STATE, updatedAt: now }, now);
    }
  });

  return report;
}

/* ---------------------------------- Внутренние резервные копии ---------------------------------- */

export async function saveInternalBackup(
  db: AppDatabase,
  backup: BackupFile,
  reason: string,
  now: number = Date.now()
): Promise<string> {
  const id = newId();
  await db.driver.run(
    'INSERT INTO data_backups (id, created_at, reason, payload_json) VALUES (?, ?, ?, ?)',
    [id, now, reason, serializeBackup(backup)]
  );
  return id;
}

export interface InternalBackupInfo {
  id: string;
  createdAt: number;
  reason: string;
  sizeBytes: number;
}

export async function listInternalBackups(db: AppDatabase): Promise<InternalBackupInfo[]> {
  const rows = await db.driver.getAll<{ id: string; created_at: number; reason: string; payload_json: string }>(
    'SELECT id, created_at, reason, payload_json FROM data_backups ORDER BY created_at DESC LIMIT 10'
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    reason: r.reason,
    sizeBytes: r.payload_json.length,
  }));
}

export async function restoreInternalBackup(
  db: AppDatabase,
  backupId: string,
  now: number = Date.now()
): Promise<ImportReport> {
  const row = await db.driver.getFirst<{ payload_json: string }>(
    'SELECT payload_json FROM data_backups WHERE id = ?',
    [backupId]
  );
  if (!row) throw new ImportError('Внутренняя резервная копия не найдена');
  const backup = parseBackup(row.payload_json);
  return importBackup(db, backup, 'replace', now);
}

export async function deleteInternalBackup(db: AppDatabase, backupId: string): Promise<boolean> {
  const res = await db.driver.run('DELETE FROM data_backups WHERE id = ?', [backupId]);
  return res.changes > 0;
}

/**
 * Полный сброс пользовательских данных (с предварительной внутренней копией).
 * Настройки возвращаются к значениям по умолчанию.
 */
export async function wipeAllData(
  db: AppDatabase,
  reason = 'user-reset',
  now: number = Date.now()
): Promise<{ internalBackupId: string }> {
  const snapshot = await exportAll(db, now);
  const internalBackupId = await saveInternalBackup(db, snapshot, reason, now);
  await db.driver.transaction(async () => {
    await db.driver.exec('DELETE FROM subtasks');
    await db.driver.exec('DELETE FROM events');
    await db.driver.exec('DELETE FROM study_sessions');
    await db.driver.exec('DELETE FROM tasks');
    await db.driver.exec('DELETE FROM goals');
    await db.driver.exec('DELETE FROM debts');
    await db.driver.exec('DELETE FROM lesson_notes');
    await db.driver.exec('DELETE FROM subjects');
    await db.driver.exec('DELETE FROM plan_history');
    await db.settings.replace({ ...DEFAULT_SETTINGS, createdAt: now, updatedAt: now });
    await db.timer.reset({ ...IDLE_TIMER_STATE, updatedAt: now }, now);
  });
  return { internalBackupId };
}
