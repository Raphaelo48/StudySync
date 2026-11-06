import { newId } from '../../core/id';
import type { Goal, GoalMetric, GoalPeriod, ID } from '../../models/types';
import type { SqlDriver } from '../driver';
import { mapGoal, type GoalRow } from '../mappers';

export interface GoalInput {
  subjectId?: ID | null;
  metric: GoalMetric;
  targetValue: number;
  period: GoalPeriod;
  periodStartAt?: number | null;
  periodEndAt?: number | null;
  note?: string | null;
}

const SELECT_COLS = `id, subject_id, metric, target_value, period, period_start_at, period_end_at, note, created_at`;

export class GoalsRepo {
  constructor(private readonly driver: SqlDriver) {}

  async list(): Promise<Goal[]> {
    const rows = await this.driver.getAll<GoalRow>(
      `SELECT ${SELECT_COLS} FROM goals ORDER BY created_at`
    );
    return rows.map(mapGoal);
  }

  async get(id: ID): Promise<Goal | null> {
    const row = await this.driver.getFirst<GoalRow>(`SELECT ${SELECT_COLS} FROM goals WHERE id = ?`, [id]);
    return row ? mapGoal(row) : null;
  }

  async create(input: GoalInput, now: number = Date.now()): Promise<Goal> {
    const goal: Goal = {
      id: newId(),
      subjectId: input.subjectId ?? null,
      metric: input.metric,
      targetValue: input.targetValue,
      period: input.period,
      periodStartAt: input.periodStartAt ?? null,
      periodEndAt: input.periodEndAt ?? null,
      note: input.note?.trim() || null,
      createdAt: now,
    };
    await this.driver.run(
      `INSERT INTO goals (id, subject_id, metric, target_value, period, period_start_at, period_end_at, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        goal.id, goal.subjectId, goal.metric, goal.targetValue, goal.period,
        goal.periodStartAt, goal.periodEndAt, goal.note, goal.createdAt,
      ]
    );
    return goal;
  }

  async update(id: ID, patch: Partial<GoalInput>, now: number = Date.now()): Promise<Goal | null> {
    const current = await this.get(id);
    if (!current) return null;
    void now;
    const next: Goal = {
      ...current,
      ...(patch.subjectId !== undefined ? { subjectId: patch.subjectId } : {}),
      ...(patch.metric !== undefined ? { metric: patch.metric } : {}),
      ...(patch.targetValue !== undefined ? { targetValue: patch.targetValue } : {}),
      ...(patch.period !== undefined ? { period: patch.period } : {}),
      ...(patch.periodStartAt !== undefined ? { periodStartAt: patch.periodStartAt } : {}),
      ...(patch.periodEndAt !== undefined ? { periodEndAt: patch.periodEndAt } : {}),
      ...(patch.note !== undefined ? { note: patch.note?.trim() || null } : {}),
    };
    await this.driver.run(
      `UPDATE goals SET subject_id = ?, metric = ?, target_value = ?, period = ?,
        period_start_at = ?, period_end_at = ?, note = ? WHERE id = ?`,
      [
        next.subjectId, next.metric, next.targetValue, next.period,
        next.periodStartAt, next.periodEndAt, next.note, id,
      ]
    );
    return next;
  }

  async delete(id: ID): Promise<boolean> {
    const res = await this.driver.run('DELETE FROM goals WHERE id = ?', [id]);
    return res.changes > 0;
  }
}
