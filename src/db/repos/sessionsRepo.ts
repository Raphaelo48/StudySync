import { newId } from '../../core/id';
import type { ID, SessionMode, StudySession } from '../../models/types';
import type { SqlDriver } from '../driver';
import { mapSession, toInt, type StudySessionRow } from '../mappers';

export interface SessionInput {
  taskId?: ID | null;
  subjectId?: ID | null;
  startedAt: number;
  endedAt: number;
  activeSeconds: number;
  breakSeconds?: number;
  mode?: SessionMode;
  completed?: boolean;
  notes?: string | null;
}

const SELECT_COLS = `id, task_id, subject_id, started_at, ended_at, active_seconds, break_seconds, mode, completed, notes`;

export class SessionsRepo {
  constructor(private readonly driver: SqlDriver) {}

  async create(input: SessionInput): Promise<StudySession> {
    if (!(input.activeSeconds > 0)) {
      throw new Error('Сессия без активного времени не сохраняется');
    }
    if (input.endedAt < input.startedAt) {
      throw new Error('ended_at не может быть раньше started_at');
    }
    const session: StudySession = {
      id: newId(),
      taskId: input.taskId ?? null,
      subjectId: input.subjectId ?? null,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      activeSeconds: Math.round(input.activeSeconds),
      breakSeconds: Math.max(0, Math.round(input.breakSeconds ?? 0)),
      mode: input.mode ?? 'pomodoro',
      completed: input.completed ?? false,
      notes: input.notes ?? null,
    };
    await this.driver.run(
      `INSERT INTO study_sessions (id, task_id, subject_id, started_at, ended_at, active_seconds,
        break_seconds, mode, completed, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.id, session.taskId, session.subjectId, session.startedAt, session.endedAt,
        session.activeSeconds, session.breakSeconds, session.mode, toInt(session.completed), session.notes,
      ]
    );
    return session;
  }

  async listRange(from: number, to: number): Promise<StudySession[]> {
    const rows = await this.driver.getAll<StudySessionRow>(
      `SELECT ${SELECT_COLS} FROM study_sessions WHERE started_at >= ? AND started_at < ? ORDER BY started_at`,
      [from, to]
    );
    return rows.map(mapSession);
  }

  async listByTask(taskId: ID): Promise<StudySession[]> {
    const rows = await this.driver.getAll<StudySessionRow>(
      `SELECT ${SELECT_COLS} FROM study_sessions WHERE task_id = ? ORDER BY started_at DESC`,
      [taskId]
    );
    return rows.map(mapSession);
  }

  async listRecent(limit = 20): Promise<StudySession[]> {
    const rows = await this.driver.getAll<StudySessionRow>(
      `SELECT ${SELECT_COLS} FROM study_sessions ORDER BY started_at DESC LIMIT ?`,
      [limit]
    );
    return rows.map(mapSession);
  }

  async delete(id: ID): Promise<boolean> {
    const res = await this.driver.run('DELETE FROM study_sessions WHERE id = ?', [id]);
    return res.changes > 0;
  }

  /** Суммарное активное время (сек) за период. */
  async totalActiveSeconds(from: number, to: number): Promise<number> {
    const row = await this.driver.getFirst<{ total: number | null }>(
      'SELECT COALESCE(SUM(active_seconds), 0) AS total FROM study_sessions WHERE started_at >= ? AND started_at < ?',
      [from, to]
    );
    return row?.total ?? 0;
  }
}
