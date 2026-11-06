/**
 * Преобразования строка БД (snake_case) ↔ доменная модель (camelCase).
 * SQLite хранит логические значения как 0/1.
 */
import type {
  CalendarEvent,
  Goal,
  GoalMetric,
  GoalPeriod,
  PlanRecord,
  RecurrenceRule,
  SessionMode,
  StudySession,
  Subject,
  Subtask,
  Task,
  TaskDifficulty,
  TaskPriority,
  TaskStatus,
  TimerState,
  EventKind,
  ID,
} from '../models/types';

export function toBool(value: number | null | undefined): boolean {
  return value === 1;
}

export function toInt(value: boolean): number {
  return value ? 1 : 0;
}

function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

/* ---------------------------------- Subjects ---------------------------------- */

export interface SubjectRow {
  id: string;
  source?: string | null;
  source_ref?: string | null;
  name: string;
  description: string | null;
  color: string;
  target_grade: string | null;
  note: string | null;
  archived: number;
  created_at: number;
  updated_at: number;
}

export function mapSubject(row: SubjectRow): Subject {
  return {
    id: row.id,
    source: (row.source === 'moodle' ? 'moodle' : 'manual') as Subject['source'],
    sourceRef: strOrNull(row.source_ref),
    name: row.name,
    description: row.description,
    color: row.color,
    targetGrade: row.target_grade,
    note: row.note,
    archived: toBool(row.archived),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ---------------------------------- Tasks ---------------------------------- */

export interface TaskRow {
  id: string;
  source?: string | null;
  source_ref?: string | null;
  title: string;
  description: string | null;
  subject_id: string | null;
  deadline_at: number | null;
  planned_minutes: number;
  difficulty: number;
  priority: number;
  status: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  actual_minutes: number;
  defer_count: number;
  scheduled_start_at: number | null;
  scheduled_end_at: number | null;
  subject_name?: string | null;
  subject_color?: string | null;
}

export function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    source: (row.source === 'moodle' ? 'moodle' : 'manual') as Task['source'],
    sourceRef: strOrNull(row.source_ref),
    title: row.title,
    description: row.description,
    subjectId: row.subject_id,
    deadlineAt: row.deadline_at,
    plannedMinutes: row.planned_minutes,
    difficulty: row.difficulty as TaskDifficulty,
    priority: row.priority as TaskPriority,
    status: row.status as TaskStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    actualMinutes: row.actual_minutes,
    deferCount: row.defer_count,
    scheduledStartAt: row.scheduled_start_at,
    scheduledEndAt: row.scheduled_end_at,
  };
}

export function mapTaskWithSubject(row: TaskRow): Task & { subject: { id: ID; name: string; color: string } | null } {
  const task = mapTask(row);
  const subject =
    row.subject_id && row.subject_name
      ? { id: row.subject_id, name: row.subject_name, color: row.subject_color ?? '#7C6CF0' }
      : null;
  return { ...task, subject };
}

/* ---------------------------------- Subtasks ---------------------------------- */

export interface SubtaskRow {
  id: string;
  task_id: string;
  title: string;
  done: number;
  position: number;
  due_at?: number | null;
  created_at: number;
}

export function mapSubtask(row: SubtaskRow): Subtask {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title,
    done: toBool(row.done),
    position: row.position,
    dueAt: row.due_at ?? null,
    createdAt: row.created_at,
  };
}

/* ---------------------------------- Events ---------------------------------- */

export interface EventRow {
  id: string;
  title: string;
  kind: string;
  subject_id: string | null;
  task_id: string | null;
  location: string | null;
  start_at: number;
  end_at: number;
  notes: string | null;
  series_id: string | null;
  recurrence_json: string | null;
  notify_offset_minutes: number | null;
  source?: string | null;
  source_ref?: string | null;
  created_at: number;
  updated_at: number;
  subject_name?: string | null;
  subject_color?: string | null;
  task_title?: string | null;
  task_status?: string | null;
}

export function mapEvent(row: EventRow): CalendarEvent {
  let recurrence: RecurrenceRule | null = null;
  const raw = strOrNull(row.recurrence_json);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed === 'object' &&
        ('freq' in parsed)
      ) {
        recurrence = parsed as RecurrenceRule;
      }
    } catch {
      recurrence = null;
    }
  }
  return {
    id: row.id,
    title: row.title,
    kind: row.kind as EventKind,
    subjectId: row.subject_id,
    taskId: row.task_id,
    location: row.location,
    startAt: row.start_at,
    endAt: row.end_at,
    notes: row.notes,
    seriesId: row.series_id,
    recurrence,
    notifyOffsetMinutes: numOrNull(row.notify_offset_minutes),
    source: (row.source === 'kgeu' || row.source === 'moodle' ? row.source : 'manual') as CalendarEvent['source'],
    sourceRef: strOrNull(row.source_ref),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ---------------------------------- StudySessions ---------------------------------- */

export interface StudySessionRow {
  id: string;
  task_id: string | null;
  subject_id: string | null;
  started_at: number;
  ended_at: number;
  active_seconds: number;
  break_seconds: number;
  mode: string;
  completed: number;
  notes: string | null;
}

export function mapSession(row: StudySessionRow): StudySession {
  return {
    id: row.id,
    taskId: row.task_id,
    subjectId: row.subject_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    activeSeconds: row.active_seconds,
    breakSeconds: row.break_seconds,
    mode: row.mode as SessionMode,
    completed: toBool(row.completed),
    notes: row.notes,
  };
}

/* ---------------------------------- Goals ---------------------------------- */

export interface GoalRow {
  id: string;
  subject_id: string | null;
  metric: string;
  target_value: number;
  period: string;
  period_start_at: number | null;
  period_end_at: number | null;
  note: string | null;
  created_at: number;
}

export function mapGoal(row: GoalRow): Goal {
  return {
    id: row.id,
    subjectId: row.subject_id,
    metric: row.metric as GoalMetric,
    targetValue: row.target_value,
    period: row.period as GoalPeriod,
    periodStartAt: row.period_start_at,
    periodEndAt: row.period_end_at,
    note: row.note,
    createdAt: row.created_at,
  };
}

/* ---------------------------------- TimerState ---------------------------------- */

export interface TimerStateRow {
  status: string;
  mode: string;
  phase: string;
  task_id: string | null;
  subject_id: string | null;
  phase_started_at: number | null;
  work_index: number;
  accumulated_work_ms: number;
  accumulated_break_ms: number;
  completed_break_ms?: number | null;
  planned_work_sec: number;
  planned_break_sec: number;
  planned_long_break_sec: number;
  cycles_before_long_break: number;
  session_started_at: number | null;
  updated_at: number;
}

export function mapTimerState(row: TimerStateRow): TimerState {
  return {
    status: row.status as TimerState['status'],
    mode: row.mode as SessionMode,
    phase: row.phase as TimerState['phase'],
    taskId: row.task_id,
    subjectId: row.subject_id,
    phaseStartedAt: row.phase_started_at,
    workIndex: row.work_index,
    accumulatedWorkMs: row.accumulated_work_ms,
    accumulatedBreakMs: row.accumulated_break_ms,
    completedBreakMs: row.completed_break_ms ?? 0,
    plannedWorkSec: row.planned_work_sec,
    plannedBreakSec: row.planned_break_sec,
    plannedLongBreakSec: row.planned_long_break_sec,
    cyclesBeforeLongBreak: row.cycles_before_long_break,
    sessionStartedAt: row.session_started_at,
    updatedAt: row.updated_at,
  };
}

/* ---------------------------------- PlanRecord ---------------------------------- */

export interface PlanRow {
  id: string;
  created_at: number;
  applied: number;
  plan_json: string;
  created_event_ids_json: string | null;
}

export function mapPlanRecord(row: PlanRow): PlanRecord {
  let createdEventIds: ID[] | null = null;
  const raw = strOrNull(row.created_event_ids_json);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) createdEventIds = parsed as ID[];
    } catch {
      createdEventIds = null;
    }
  }
  return {
    id: row.id,
    createdAt: row.created_at,
    applied: toBool(row.applied),
    planJson: row.plan_json,
    createdEventIds,
  };
}
