/**
 * Доменные модели StudySync.
 *
 * Все временные поля — миллисекунды с эпохи Unix (см. src/core/time.ts).
 */
import type { Timestamp } from '../core/time';

export type ID = string;

/* ---------------------------------- Справочники ---------------------------------- */

export type TaskStatus = 'planned' | 'in_progress' | 'done' | 'deferred';
export type TaskPriority = 1 | 2 | 3; // 1 — низкий, 2 — средний, 3 — высокий
export type TaskDifficulty = 1 | 2 | 3; // 1 — легко, 2 — средне, 3 — сложно
export type EventKind = 'lesson' | 'personal' | 'study';
export type ThemeMode = 'light' | 'dark' | 'system';
/** Цвет акцента интерфейса (см. ACCENTS в theme/tokens). */
export type AccentId = 'violet' | 'blue' | 'teal' | 'green' | 'orange' | 'pink';
export type FontScale = 'small' | 'normal' | 'large';
/** Вкладка, которая открывается при запуске. */
export type StartTab = 'index' | 'schedule' | 'tasks';
/** Отключаемые блоки главного экрана. */
export type HomeBlock = 'stats' | 'dayload' | 'lessons' | 'debts' | 'priority' | 'deadlines';
/** Что искать в расписании КГЭУ. */
export type KgeuTargetKind = 'group' | 'teacher' | 'aud';
export interface KgeuRecent {
  kind: KgeuTargetKind;
  id: number;
  name: string;
}
export type SessionMode = 'pomodoro' | 'stopwatch';
export type GoalMetric = 'study_minutes' | 'completed_tasks';
export type GoalPeriod = 'week' | 'month' | 'semester';

export const TASK_STATUSES: TaskStatus[] = ['planned', 'in_progress', 'done', 'deferred'];

export const STATUS_LABELS: Record<TaskStatus, string> = {
  planned: 'Запланирована',
  in_progress: 'В процессе',
  done: 'Выполнена',
  deferred: 'Отложена',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  1: 'Низкий',
  2: 'Средний',
  3: 'Высокий',
};

export const DIFFICULTY_LABELS: Record<TaskDifficulty, string> = {
  1: 'Лёгкая',
  2: 'Средняя',
  3: 'Сложная',
};

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  lesson: 'Занятие',
  personal: 'Личное событие',
  study: 'Учебный блок',
};

/* ---------------------------------- Сущности ---------------------------------- */

export interface Subject {
  id: ID;
  source: SubjectSource;
  sourceRef: string | null;
  name: string;
  description: string | null;
  color: string;
  targetGrade: string | null;
  note: string | null;
  archived: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Task {
  id: ID;
  source: TaskSource;
  sourceRef: string | null;
  title: string;
  description: string | null;
  subjectId: ID | null;
  deadlineAt: Timestamp | null;
  plannedMinutes: number;
  difficulty: TaskDifficulty;
  priority: TaskPriority;
  status: TaskStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt: Timestamp | null;
  actualMinutes: number;
  deferCount: number;
  /** Окно, рекомендованное перепланировщиком или заданное вручную. */
  scheduledStartAt: Timestamp | null;
  scheduledEndAt: Timestamp | null;
}

export interface Subtask {
  id: ID;
  taskId: ID;
  title: string;
  done: boolean;
  position: number;
  /** Срок этапа (для задач из шаблона), необязателен. */
  dueAt: Timestamp | null;
  createdAt: Timestamp;
}

/* ---------------------------------- Долги и отработки ---------------------------------- */

export type DebtKind = 'lab' | 'credit' | 'exam' | 'absence' | 'coursework' | 'other';
export type DebtStatus = 'open' | 'scheduled' | 'passed';

export const DEBT_KIND_LABELS: Record<DebtKind, string> = {
  lab: 'Лабораторная',
  credit: 'Зачёт',
  exam: 'Экзамен',
  absence: 'Отработка пропуска',
  coursework: 'Курсовая',
  other: 'Другое',
};

export const DEBT_STATUS_LABELS: Record<DebtStatus, string> = {
  open: 'Не сдано',
  scheduled: 'Назначено',
  passed: 'Сдано',
};

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface Debt {
  id: ID;
  subjectId: ID | null;
  title: string;
  kind: DebtKind;
  teacher: string | null;
  /** Номер попытки: 1 — первая сдача, 2 — первая пересдача, 3 — вторая (комиссия). */
  attempt: number;
  /** Дата и время отработки/пересдачи. */
  retakeAt: Timestamp | null;
  location: string | null;
  checklist: ChecklistItem[];
  status: DebtStatus;
  notes: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  passedAt: Timestamp | null;
}

export interface DebtWithSubject extends Debt {
  subject: Pick<Subject, 'id' | 'name' | 'color'> | null;
}

/* ---------------------------------- Конспекты к парам ---------------------------------- */

export interface LessonNote {
  id: ID;
  subjectId: ID | null;
  /**
   * Ключ пары: не id события (импорт КГЭУ пересоздаёт события), а предмет/название + начало.
   * См. lessonKeyFor в logic/lessonNotes.
   */
  lessonKey: string;
  lessonTitle: string;
  lessonStartAt: Timestamp;
  text: string;
  important: boolean;
  /** Имена файлов фото в каталоге конспектов. */
  photos: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface RecurrenceRule {
  freq: 'daily' | 'weekly';
  /** 0=вс … 6=сб; обязателен для weekly. */
  daysOfWeek?: number[];
  until: Timestamp | null;
  count?: number | null;
}

export interface CalendarEvent {
  id: ID;
  title: string;
  kind: EventKind;
  subjectId: ID | null;
  taskId: ID | null;
  location: string | null;
  startAt: Timestamp;
  endAt: Timestamp;
  notes: string | null;
  seriesId: ID | null;
  recurrence: RecurrenceRule | null;
  notifyOffsetMinutes: number | null;
  /** Происхождение: 'manual' — пользователь, 'kgeu' — расписание КГЭУ, 'moodle' — LMS Moodle. */
  source: EventSource;
  /** Внешний ключ источника (например, '14569:4833721'), для синхронизации импорта. */
  sourceRef: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type EventSource = 'manual' | 'kgeu' | 'moodle';
export type SubjectSource = 'manual' | 'moodle';
export type TaskSource = 'manual' | 'moodle';

export interface StudySession {
  id: ID;
  taskId: ID | null;
  subjectId: ID | null;
  startedAt: Timestamp;
  endedAt: Timestamp;
  /** Фактическое активное время работы, секунды (без пауз и перерывов). */
  activeSeconds: number;
  breakSeconds: number;
  mode: SessionMode;
  completed: boolean;
  notes: string | null;
}

export interface UserSettings {
  displayName: string;
  themeMode: ThemeMode;
  /** 1 = понедельник, 0 = воскресенье. */
  weekStart: 0 | 1;
  notificationsEnabled: boolean;
  notifyLesson: boolean;
  notifyLessonBeforeMin: number;
  notifyDeadline: boolean;
  notifyDeadlineBeforeMin: number;
  notifySession: boolean;
  notifyBreak: boolean;
  defaultWorkMin: number;
  defaultBreakMin: number;
  defaultLongBreakMin: number;
  cyclesBeforeLongBreak: number;
  dailyGoalMin: number;
  /** Учебное окно — доступное для учёбы время суток, в минутах от полуночи. */
  studyWindowStartMin: number;
  studyWindowEndMin: number;
  breakBetweenTasksMin: number;
  planningHorizonDays: number;
  onboardingDone: boolean;
  /** Утренняя сводка: одно уведомление в день с парами и дедлайнами. */
  morningDigestEnabled: boolean;
  /** Время сводки, минуты от полуночи. */
  morningDigestTimeMin: number;
  /* ---- Персонализация (хранится в user_settings.prefs_json) ---- */
  accentColor: AccentId;
  fontScale: FontScale;
  startTab: StartTab;
  homeHiddenBlocks: HomeBlock[];
  /** Компактные карточки пар в расписании. */
  compactSchedule: boolean;
  /* ---- Расписание КГЭУ ---- */
  /** Тихо обновлять расписание своей группы при открытии приложения. */
  autoSyncGroup: boolean;
  /** Своя группа: запоминается при импорте расписания. */
  kgeuGroupId: number | null;
  kgeuGroupName: string | null;
  /** Когда расписание группы последний раз успешно обновлялось. */
  kgeuLastSyncAt: Timestamp | null;
  /** Недавние запросы поиска расписания (новые — первыми). */
  kgeuRecent: KgeuRecent[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Goal {
  id: ID;
  subjectId: ID | null;
  metric: GoalMetric;
  targetValue: number;
  period: GoalPeriod;
  periodStartAt: Timestamp | null;
  periodEndAt: Timestamp | null;
  note: string | null;
  createdAt: Timestamp;
}

export interface TimerState {
  status: 'idle' | 'running' | 'paused';
  mode: SessionMode;
  phase: 'none' | 'work' | 'break';
  taskId: ID | null;
  subjectId: ID | null;
  /** Метка начала текущего непрерывного отрезка (running) или null (paused/idle). */
  phaseStartedAt: Timestamp | null;
  /** Сколько рабочих циклов завершено. */
  workIndex: number;
  accumulatedWorkMs: number;
  /** Прогресс текущего перерыва, мс. */
  accumulatedBreakMs: number;
  /** Сумма уже завершённых (или пропущенных) перерывов сессии, мс. */
  completedBreakMs: number;
  plannedWorkSec: number;
  plannedBreakSec: number;
  plannedLongBreakSec: number;
  cyclesBeforeLongBreak: number;
  sessionStartedAt: Timestamp | null;
  updatedAt: Timestamp;
}

export interface PlanRecord {
  id: ID;
  createdAt: Timestamp;
  applied: boolean;
  planJson: string;
  createdEventIds: ID[] | null;
}

/* ---------------------------------- Проекция задач ---------------------------------- */

export interface TaskWithSubject extends Task {
  subject: Pick<Subject, 'id' | 'name' | 'color'> | null;
}

export interface EventWithRelations extends CalendarEvent {
  subject: Pick<Subject, 'id' | 'name' | 'color'> | null;
  task: Pick<Task, 'id' | 'title' | 'status'> | null;
}

export const DEFAULT_SETTINGS: UserSettings = {
  displayName: '',
  themeMode: 'system',
  weekStart: 1,
  notificationsEnabled: true,
  notifyLesson: true,
  notifyLessonBeforeMin: 15,
  notifyDeadline: true,
  notifyDeadlineBeforeMin: 60,
  notifySession: true,
  notifyBreak: true,
  defaultWorkMin: 25,
  defaultBreakMin: 5,
  defaultLongBreakMin: 15,
  cyclesBeforeLongBreak: 4,
  dailyGoalMin: 120,
  studyWindowStartMin: 9 * 60,
  studyWindowEndMin: 22 * 60,
  breakBetweenTasksMin: 5,
  planningHorizonDays: 7,
  onboardingDone: false,
  morningDigestEnabled: true,
  morningDigestTimeMin: 7 * 60 + 30,
  accentColor: 'violet',
  fontScale: 'normal',
  startTab: 'index',
  homeHiddenBlocks: [],
  compactSchedule: false,
  autoSyncGroup: true,
  kgeuGroupId: null,
  kgeuGroupName: null,
  kgeuLastSyncAt: null,
  kgeuRecent: [],
  createdAt: 0,
  updatedAt: 0,
};

export const IDLE_TIMER_STATE: TimerState = {
  status: 'idle',
  mode: 'pomodoro',
  phase: 'none',
  taskId: null,
  subjectId: null,
  phaseStartedAt: null,
  workIndex: 0,
  accumulatedWorkMs: 0,
  accumulatedBreakMs: 0,
  completedBreakMs: 0,
  plannedWorkSec: 25 * 60,
  plannedBreakSec: 5 * 60,
  plannedLongBreakSec: 15 * 60,
  cyclesBeforeLongBreak: 4,
  sessionStartedAt: null,
  updatedAt: 0,
};

/* ---------------------------------- Палитра предметов ---------------------------------- */

export const SUBJECT_COLORS = [
  '#7C6CF0',
  '#5AA7F0',
  '#34C7A0',
  '#E8B33C',
  '#E87461',
  '#C77DBB',
  '#6FA8DC',
  '#93B35B',
];
