import { DEFAULT_SETTINGS, type UserSettings } from '../../models/types';
import type { SqlDriver } from '../driver';
import { toBool, toInt } from '../mappers';
import { parsePrefs } from '../../logic/prefs';

interface SettingsRow {
  display_name: string;
  theme_mode: string;
  week_start: number;
  notifications_enabled: number;
  notify_lesson: number;
  notify_lesson_before_min: number;
  notify_deadline: number;
  notify_deadline_before_min: number;
  notify_session: number;
  notify_break: number;
  default_work_min: number;
  default_break_min: number;
  default_long_break_min: number;
  cycles_before_long_break: number;
  daily_goal_min: number;
  study_window_start_min: number;
  study_window_end_min: number;
  break_between_tasks_min: number;
  planning_horizon_days: number;
  onboarding_done: number;
  morning_digest_enabled?: number | null;
  morning_digest_time_min?: number | null;
  prefs_json?: string | null;
  created_at: number;
  updated_at: number;
}

function mapSettings(row: SettingsRow): UserSettings {
  return {
    displayName: row.display_name,
    themeMode: row.theme_mode as UserSettings['themeMode'],
    weekStart: row.week_start as 0 | 1,
    notificationsEnabled: toBool(row.notifications_enabled),
    notifyLesson: toBool(row.notify_lesson),
    notifyLessonBeforeMin: row.notify_lesson_before_min,
    notifyDeadline: toBool(row.notify_deadline),
    notifyDeadlineBeforeMin: row.notify_deadline_before_min,
    notifySession: toBool(row.notify_session),
    notifyBreak: toBool(row.notify_break),
    defaultWorkMin: row.default_work_min,
    defaultBreakMin: row.default_break_min,
    defaultLongBreakMin: row.default_long_break_min,
    cyclesBeforeLongBreak: row.cycles_before_long_break,
    dailyGoalMin: row.daily_goal_min,
    studyWindowStartMin: row.study_window_start_min,
    studyWindowEndMin: row.study_window_end_min,
    breakBetweenTasksMin: row.break_between_tasks_min,
    planningHorizonDays: row.planning_horizon_days,
    onboardingDone: toBool(row.onboarding_done),
    morningDigestEnabled: row.morning_digest_enabled == null ? true : toBool(row.morning_digest_enabled),
    morningDigestTimeMin: row.morning_digest_time_min ?? DEFAULT_SETTINGS.morningDigestTimeMin,
    ...parsePrefs(row.prefs_json ?? '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SettingsRepo {
  constructor(private readonly driver: SqlDriver) {}

  /** Создать строку настроек по умолчанию, если её нет (вызывается при открытии БД). */
  async ensureRow(now: number = Date.now()): Promise<void> {
    await this.driver.run(
      `INSERT OR IGNORE INTO user_settings (id, created_at, updated_at) VALUES (1, ?, ?)`,
      [now, now]
    );
  }

  async get(): Promise<UserSettings> {
    const row = await this.driver.getFirst<SettingsRow>('SELECT * FROM user_settings WHERE id = 1');
    if (!row) {
      // Теоретически невозможно после ensureRow; защищаемся от гонки.
      await this.ensureRow();
      const retry = await this.driver.getFirst<SettingsRow>('SELECT * FROM user_settings WHERE id = 1');
      if (!retry) return { ...DEFAULT_SETTINGS, createdAt: Date.now(), updatedAt: Date.now() };
      return mapSettings(retry);
    }
    return mapSettings(row);
  }

  async update(patch: Partial<Omit<UserSettings, 'createdAt' | 'updatedAt'>>, now: number = Date.now()): Promise<UserSettings> {
    const current = await this.get();
    const next: UserSettings = { ...current, ...patch, updatedAt: now };
    await this.driver.run(
      `UPDATE user_settings SET
        display_name = ?, theme_mode = ?, week_start = ?, notifications_enabled = ?,
        notify_lesson = ?, notify_lesson_before_min = ?, notify_deadline = ?, notify_deadline_before_min = ?,
        notify_session = ?, notify_break = ?, default_work_min = ?, default_break_min = ?,
        default_long_break_min = ?, cycles_before_long_break = ?, daily_goal_min = ?,
        study_window_start_min = ?, study_window_end_min = ?, break_between_tasks_min = ?,
        planning_horizon_days = ?, onboarding_done = ?, morning_digest_enabled = ?,
        morning_digest_time_min = ?, prefs_json = ?, updated_at = ?
       WHERE id = 1`,
      [
        next.displayName, next.themeMode, next.weekStart, toInt(next.notificationsEnabled),
        toInt(next.notifyLesson), next.notifyLessonBeforeMin, toInt(next.notifyDeadline),
        next.notifyDeadlineBeforeMin, toInt(next.notifySession), toInt(next.notifyBreak),
        next.defaultWorkMin, next.defaultBreakMin, next.defaultLongBreakMin, next.cyclesBeforeLongBreak,
        next.dailyGoalMin, next.studyWindowStartMin, next.studyWindowEndMin, next.breakBetweenTasksMin,
        next.planningHorizonDays, toInt(next.onboardingDone), toInt(next.morningDigestEnabled),
        next.morningDigestTimeMin, JSON.stringify(parsePrefs(next)), next.updatedAt,
      ]
    );
    return next;
  }

  /** Заменить настройки целиком (используется импортом данных). */
  async replace(settings: UserSettings): Promise<void> {
    await this.driver.run(
      `INSERT INTO user_settings (id, display_name, theme_mode, week_start, notifications_enabled,
        notify_lesson, notify_lesson_before_min, notify_deadline, notify_deadline_before_min,
        notify_session, notify_break, default_work_min, default_break_min, default_long_break_min,
        cycles_before_long_break, daily_goal_min, study_window_start_min, study_window_end_min,
        break_between_tasks_min, planning_horizon_days, onboarding_done, morning_digest_enabled,
        morning_digest_time_min, prefs_json, created_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name, theme_mode = excluded.theme_mode, week_start = excluded.week_start,
        notifications_enabled = excluded.notifications_enabled, notify_lesson = excluded.notify_lesson,
        notify_lesson_before_min = excluded.notify_lesson_before_min, notify_deadline = excluded.notify_deadline,
        notify_deadline_before_min = excluded.notify_deadline_before_min, notify_session = excluded.notify_session,
        notify_break = excluded.notify_break, default_work_min = excluded.default_work_min,
        default_break_min = excluded.default_break_min, default_long_break_min = excluded.default_long_break_min,
        cycles_before_long_break = excluded.cycles_before_long_break, daily_goal_min = excluded.daily_goal_min,
        study_window_start_min = excluded.study_window_start_min, study_window_end_min = excluded.study_window_end_min,
        break_between_tasks_min = excluded.break_between_tasks_min, planning_horizon_days = excluded.planning_horizon_days,
        onboarding_done = excluded.onboarding_done, morning_digest_enabled = excluded.morning_digest_enabled,
        morning_digest_time_min = excluded.morning_digest_time_min, prefs_json = excluded.prefs_json,
        updated_at = excluded.updated_at`,
      [
        settings.displayName, settings.themeMode, settings.weekStart, toInt(settings.notificationsEnabled),
        toInt(settings.notifyLesson), settings.notifyLessonBeforeMin, toInt(settings.notifyDeadline),
        settings.notifyDeadlineBeforeMin, toInt(settings.notifySession), toInt(settings.notifyBreak),
        settings.defaultWorkMin, settings.defaultBreakMin, settings.defaultLongBreakMin,
        settings.cyclesBeforeLongBreak, settings.dailyGoalMin, settings.studyWindowStartMin,
        settings.studyWindowEndMin, settings.breakBetweenTasksMin, settings.planningHorizonDays,
        toInt(settings.onboardingDone), toInt(settings.morningDigestEnabled ?? true),
        settings.morningDigestTimeMin ?? DEFAULT_SETTINGS.morningDigestTimeMin,
        JSON.stringify(parsePrefs(settings)),
        settings.createdAt, settings.updatedAt,
      ]
    );
  }
}
