import { newId } from '../../core/id';
import type { ID, PlanRecord } from '../../models/types';
import type { SqlDriver } from '../driver';
import { mapPlanRecord, toInt, type PlanRow } from '../mappers';

const SELECT_COLS = `id, created_at, applied, plan_json, created_event_ids_json`;

/**
 * История предложенных планов перепланировщика.
 * Позволяет отменить применение последнего плана (по сохранённым id событий).
 */
export class PlanHistoryRepo {
  constructor(private readonly driver: SqlDriver) {}

  async add(planJson: string, now: number = Date.now()): Promise<PlanRecord> {
    const record: PlanRecord = { id: newId(), createdAt: now, applied: false, planJson, createdEventIds: null };
    await this.driver.run(
      `INSERT INTO plan_history (id, created_at, applied, plan_json, created_event_ids_json)
       VALUES (?, ?, ?, ?, ?)`,
      [record.id, record.createdAt, toInt(record.applied), record.planJson, null]
    );
    return record;
  }

  async markApplied(id: ID, createdEventIds: ID[], now: number = Date.now()): Promise<void> {
    void now;
    await this.driver.run(
      'UPDATE plan_history SET applied = 1, created_event_ids_json = ? WHERE id = ?',
      [JSON.stringify(createdEventIds), id]
    );
  }

  async markReverted(id: ID): Promise<void> {
    await this.driver.run('UPDATE plan_history SET applied = 0 WHERE id = ?', [id]);
  }

  async getLastApplied(): Promise<PlanRecord | null> {
    const row = await this.driver.getFirst<PlanRow>(
      `SELECT ${SELECT_COLS} FROM plan_history WHERE applied = 1 ORDER BY created_at DESC LIMIT 1`
    );
    return row ? mapPlanRecord(row) : null;
  }

  async get(id: ID): Promise<PlanRecord | null> {
    const row = await this.driver.getFirst<PlanRow>(`SELECT ${SELECT_COLS} FROM plan_history WHERE id = ?`, [id]);
    return row ? mapPlanRecord(row) : null;
  }
}
