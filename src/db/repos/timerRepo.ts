import type { TimerState } from '../../models/types';
import type { SqlDriver } from '../driver';
import { mapTimerState, type TimerStateRow } from '../mappers';

const SELECT_COLS = `status, mode, phase, task_id, subject_id, phase_started_at, work_index,
  accumulated_work_ms, accumulated_break_ms, completed_break_ms, planned_work_sec, planned_break_sec,
  planned_long_break_sec, cycles_before_long_break, session_started_at, updated_at`;

/**
 * Хранилище состояния таймера (строка-синглтон).
 *
 * Состояние персистентно: таймер восстанавливается по сохранённым меткам
 * времени даже после полного закрытия приложения (см. src/logic/timerModel.ts).
 */
export class TimerRepo {
  constructor(private readonly driver: SqlDriver) {}

  async ensureRow(initial: TimerState, now: number = Date.now()): Promise<void> {
    await this.driver.run(
      `INSERT OR IGNORE INTO timer_state (id, status, mode, phase, task_id, subject_id, phase_started_at,
        work_index, accumulated_work_ms, accumulated_break_ms, completed_break_ms, planned_work_sec, planned_break_sec,
        planned_long_break_sec, cycles_before_long_break, session_started_at, updated_at)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        initial.status, initial.mode, initial.phase, initial.taskId, initial.subjectId,
        initial.phaseStartedAt, initial.workIndex, initial.accumulatedWorkMs, initial.accumulatedBreakMs, initial.completedBreakMs ?? 0,
        initial.plannedWorkSec, initial.plannedBreakSec, initial.plannedLongBreakSec,
        initial.cyclesBeforeLongBreak, initial.sessionStartedAt, now,
      ]
    );
  }

  async get(fallback: TimerState): Promise<TimerState> {
    const row = await this.driver.getFirst<TimerStateRow>(
      `SELECT ${SELECT_COLS} FROM timer_state WHERE id = 1`
    );
    if (!row) return fallback;
    return mapTimerState(row);
  }

  async save(state: TimerState, now: number = Date.now()): Promise<void> {
    await this.driver.run(
      // task_id/subject_id через подзапрос: если задачу или предмет удалили во время
      // сессии, пишем NULL вместо висячей ссылки (иначе FOREIGN KEY constraint failed).
      `UPDATE timer_state SET status = ?, mode = ?, phase = ?,
        task_id = (SELECT id FROM tasks WHERE id = ?),
        subject_id = (SELECT id FROM subjects WHERE id = ?),
        phase_started_at = ?, work_index = ?, accumulated_work_ms = ?, accumulated_break_ms = ?, completed_break_ms = ?,
        planned_work_sec = ?, planned_break_sec = ?, planned_long_break_sec = ?,
        cycles_before_long_break = ?, session_started_at = ?, updated_at = ?
       WHERE id = 1`,
      [
        state.status, state.mode, state.phase, state.taskId, state.subjectId, state.phaseStartedAt,
        state.workIndex, state.accumulatedWorkMs, state.accumulatedBreakMs, state.completedBreakMs ?? 0, state.plannedWorkSec,
        state.plannedBreakSec, state.plannedLongBreakSec, state.cyclesBeforeLongBreak,
        state.sessionStartedAt, now,
      ]
    );
  }

  async reset(idle: TimerState, now: number = Date.now()): Promise<void> {
    await this.save({ ...idle, updatedAt: now }, now);
  }
}
