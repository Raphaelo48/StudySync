/**
 * Схема SQLite StudySync и механизм миграций.
 *
 * Правила:
 * - Каждая миграция — список SQL-операторов с уникальной версией.
 * - Миграции применяются строго по порядку, внутри транзакции,
 *   факт применения фиксируется в schema_migrations.
 * - Существующие миграции никогда не редактируются: изменения схемы
 *   добавляются новой миграцией, чтобы не терять данные пользователей.
 *
 * Формат хранения времени: INTEGER, миллисекунды с эпохи Unix (UTC-основание,
 * отображение в локальной зоне устройства).
 */
import type { SqlDriver } from './driver';

export const SCHEMA_VERSION = 6;

export interface Migration {
  version: number;
  statements: string[];
}

const V1: Migration = {
  version: 1,
  statements: [
    `CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      description TEXT,
      color TEXT NOT NULL DEFAULT '#7C6CF0',
      target_grade TEXT,
      note TEXT,
      archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      description TEXT,
      subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
      deadline_at INTEGER,
      planned_minutes INTEGER NOT NULL DEFAULT 30 CHECK (planned_minutes > 0),
      difficulty INTEGER NOT NULL DEFAULT 2 CHECK (difficulty IN (1, 2, 3)),
      priority INTEGER NOT NULL DEFAULT 2 CHECK (priority IN (1, 2, 3)),
      status TEXT NOT NULL DEFAULT 'planned'
        CHECK (status IN ('planned', 'in_progress', 'done', 'deferred')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      actual_minutes INTEGER NOT NULL DEFAULT 0 CHECK (actual_minutes >= 0),
      defer_count INTEGER NOT NULL DEFAULT 0 CHECK (defer_count >= 0),
      scheduled_start_at INTEGER,
      scheduled_end_at INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline_at)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_subject ON tasks(subject_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(scheduled_start_at)`,
    `CREATE TABLE IF NOT EXISTS subtasks (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
      position INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id)`,
    `CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      kind TEXT NOT NULL DEFAULT 'lesson' CHECK (kind IN ('lesson', 'personal', 'study')),
      subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
      task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      location TEXT,
      start_at INTEGER NOT NULL,
      end_at INTEGER NOT NULL,
      notes TEXT,
      series_id TEXT,
      recurrence_json TEXT,
      notify_offset_minutes INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (end_at > start_at)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_events_start ON events(start_at)`,
    `CREATE INDEX IF NOT EXISTS idx_events_series ON events(series_id)`,
    `CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id)`,
    `CREATE TABLE IF NOT EXISTS study_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      active_seconds INTEGER NOT NULL CHECK (active_seconds > 0),
      break_seconds INTEGER NOT NULL DEFAULT 0 CHECK (break_seconds >= 0),
      mode TEXT NOT NULL DEFAULT 'pomodoro' CHECK (mode IN ('pomodoro', 'stopwatch')),
      completed INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
      notes TEXT,
      CHECK (ended_at >= started_at)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_started ON study_sessions(started_at)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_task ON study_sessions(task_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sessions_subject ON study_sessions(subject_id)`,
    `CREATE TABLE IF NOT EXISTS user_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      display_name TEXT NOT NULL DEFAULT '',
      theme_mode TEXT NOT NULL DEFAULT 'system' CHECK (theme_mode IN ('light', 'dark', 'system')),
      week_start INTEGER NOT NULL DEFAULT 1 CHECK (week_start IN (0, 1)),
      notifications_enabled INTEGER NOT NULL DEFAULT 1,
      notify_lesson INTEGER NOT NULL DEFAULT 1,
      notify_lesson_before_min INTEGER NOT NULL DEFAULT 15 CHECK (notify_lesson_before_min >= 0),
      notify_deadline INTEGER NOT NULL DEFAULT 1,
      notify_deadline_before_min INTEGER NOT NULL DEFAULT 60 CHECK (notify_deadline_before_min >= 0),
      notify_session INTEGER NOT NULL DEFAULT 1,
      notify_break INTEGER NOT NULL DEFAULT 1,
      default_work_min INTEGER NOT NULL DEFAULT 25 CHECK (default_work_min >= 1),
      default_break_min INTEGER NOT NULL DEFAULT 5 CHECK (default_break_min >= 1),
      default_long_break_min INTEGER NOT NULL DEFAULT 15 CHECK (default_long_break_min >= 1),
      cycles_before_long_break INTEGER NOT NULL DEFAULT 4 CHECK (cycles_before_long_break >= 1),
      daily_goal_min INTEGER NOT NULL DEFAULT 120 CHECK (daily_goal_min >= 0),
      study_window_start_min INTEGER NOT NULL DEFAULT 540 CHECK (study_window_start_min BETWEEN 0 AND 1439),
      study_window_end_min INTEGER NOT NULL DEFAULT 1320 CHECK (study_window_end_min BETWEEN 0 AND 1439),
      break_between_tasks_min INTEGER NOT NULL DEFAULT 5 CHECK (break_between_tasks_min >= 0),
      planning_horizon_days INTEGER NOT NULL DEFAULT 7 CHECK (planning_horizon_days >= 1),
      onboarding_done INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY NOT NULL,
      subject_id TEXT REFERENCES subjects(id) ON DELETE CASCADE,
      metric TEXT NOT NULL CHECK (metric IN ('study_minutes', 'completed_tasks')),
      target_value REAL NOT NULL CHECK (target_value > 0),
      period TEXT NOT NULL CHECK (period IN ('week', 'month', 'semester')),
      period_start_at INTEGER,
      period_end_at INTEGER,
      note TEXT,
      created_at INTEGER NOT NULL,
      CHECK (period <> 'semester' OR (period_start_at IS NOT NULL AND period_end_at IS NOT NULL AND period_end_at > period_start_at))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_goals_subject ON goals(subject_id)`,
    `CREATE TABLE IF NOT EXISTS timer_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'paused')),
      mode TEXT NOT NULL DEFAULT 'pomodoro' CHECK (mode IN ('pomodoro', 'stopwatch')),
      phase TEXT NOT NULL DEFAULT 'none' CHECK (phase IN ('none', 'work', 'break')),
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
      phase_started_at INTEGER,
      work_index INTEGER NOT NULL DEFAULT 0 CHECK (work_index >= 0),
      accumulated_work_ms INTEGER NOT NULL DEFAULT 0 CHECK (accumulated_work_ms >= 0),
      accumulated_break_ms INTEGER NOT NULL DEFAULT 0 CHECK (accumulated_break_ms >= 0),
      planned_work_sec INTEGER NOT NULL DEFAULT 1500 CHECK (planned_work_sec >= 1),
      planned_break_sec INTEGER NOT NULL DEFAULT 300 CHECK (planned_break_sec >= 0),
      planned_long_break_sec INTEGER NOT NULL DEFAULT 900 CHECK (planned_long_break_sec >= 0),
      cycles_before_long_break INTEGER NOT NULL DEFAULT 4 CHECK (cycles_before_long_break >= 1),
      session_started_at INTEGER,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS plan_history (
      id TEXT PRIMARY KEY NOT NULL,
      created_at INTEGER NOT NULL,
      applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
      plan_json TEXT NOT NULL,
      created_event_ids_json TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_plan_history_created ON plan_history(created_at)`,
    `CREATE TABLE IF NOT EXISTS data_backups (
      id TEXT PRIMARY KEY NOT NULL,
      created_at INTEGER NOT NULL,
      reason TEXT NOT NULL DEFAULT 'manual',
      payload_json TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_data_backups_created ON data_backups(created_at)`,
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      applied_at INTEGER NOT NULL
    )`,
  ],
};

/**
 * v2: происхождение событий (ручные / импортированные из внешнего источника)
 * для корректной синхронизации импорта без риска удалить пользовательские данные.
 */
const V2: Migration = {
  version: 2,
  statements: [
    `ALTER TABLE events ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`,
    `ALTER TABLE events ADD COLUMN source_ref TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_events_source ON events(source, source_ref)`,
  ],
};

/**
 * v3: происхождение предметов и задач (manual | moodle) для синхронизации
 * с LMS Moodle КГЭУ без риска задеть созданные пользователем сущности.
 */
const V3: Migration = {
  version: 3,
  statements: [
    `ALTER TABLE subjects ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`,
    `ALTER TABLE subjects ADD COLUMN source_ref TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_subjects_source ON subjects(source, source_ref)`,
    `ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`,
    `ALTER TABLE tasks ADD COLUMN source_ref TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source, source_ref)`,
  ],
};

/**
 * v4: суммарное время уже завершённых перерывов сессии таймера.
 * accumulated_break_ms хранит прогресс только текущего перерыва, поэтому без
 * отдельного счётчика в итог сессии попадал лишь последний перерыв.
 */
const V4: Migration = {
  version: 4,
  statements: [
    `ALTER TABLE timer_state ADD COLUMN completed_break_ms INTEGER NOT NULL DEFAULT 0`,
  ],
};

/**
 * v5: утренняя сводка, сроки этапов (подзадач), долги и отработки, конспекты к парам.
 */
const V5: Migration = {
  version: 5,
  statements: [
    `ALTER TABLE user_settings ADD COLUMN morning_digest_enabled INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE user_settings ADD COLUMN morning_digest_time_min INTEGER NOT NULL DEFAULT 450`,
    `ALTER TABLE subtasks ADD COLUMN due_at INTEGER`,
    `CREATE TABLE IF NOT EXISTS debts (
      id TEXT PRIMARY KEY NOT NULL,
      subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      kind TEXT NOT NULL DEFAULT 'other'
        CHECK (kind IN ('lab', 'credit', 'exam', 'absence', 'coursework', 'other')),
      teacher TEXT,
      attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt >= 1),
      retake_at INTEGER,
      location TEXT,
      checklist_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'scheduled', 'passed')),
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      passed_at INTEGER
    )`,
    `CREATE INDEX IF NOT EXISTS idx_debts_status ON debts(status, retake_at)`,
    `CREATE TABLE IF NOT EXISTS lesson_notes (
      id TEXT PRIMARY KEY NOT NULL,
      subject_id TEXT REFERENCES subjects(id) ON DELETE SET NULL,
      lesson_key TEXT NOT NULL,
      lesson_title TEXT NOT NULL,
      lesson_start_at INTEGER NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      important INTEGER NOT NULL DEFAULT 0 CHECK (important IN (0, 1)),
      photos_json TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_lesson_notes_key ON lesson_notes(lesson_key)`,
    `CREATE INDEX IF NOT EXISTS idx_lesson_notes_subject ON lesson_notes(subject_id, lesson_start_at)`,
  ],
};

/**
 * v6: персонализация и данные расписания КГЭУ одним JSON-полем (см. logic/prefs).
 */
const V6: Migration = {
  version: 6,
  statements: [`ALTER TABLE user_settings ADD COLUMN prefs_json TEXT NOT NULL DEFAULT '{}'`],
};

export const MIGRATIONS: Migration[] = [V1, V2, V3, V4, V5, V6];

/**
 * Применить все неприменённые миграции в транзакции.
 * Идемпотентно: повторный вызов ничего не делает.
 */
export async function runMigrations(driver: SqlDriver): Promise<void> {
  await driver.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL,
    applied_at INTEGER NOT NULL
  )`);
  const appliedRows = await driver.getAll<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version'
  );
  const applied = new Set(appliedRows.map((r) => r.version));
  const pending = MIGRATIONS.filter((m) => !applied.has(m.version)).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return;
  await driver.transaction(async () => {
    for (const migration of pending) {
      for (const statement of migration.statements) {
        await driver.exec(statement);
      }
      await driver.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [
        migration.version,
        Date.now(),
      ]);
    }
  });
}

/** Текущая версия схемы в базе. */
export async function getSchemaVersion(driver: SqlDriver): Promise<number> {
  const row = await driver.getFirst<{ v: number | null }>(
    'SELECT MAX(version) AS v FROM schema_migrations'
  );
  return row?.v ?? 0;
}
