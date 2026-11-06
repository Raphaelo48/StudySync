import { newId } from '../../core/id';
import type { ID, Subtask } from '../../models/types';
import type { SqlDriver } from '../driver';
import { mapSubtask, toInt, type SubtaskRow } from '../mappers';

export class SubtasksRepo {
  constructor(private readonly driver: SqlDriver) {}

  async listByTask(taskId: ID): Promise<Subtask[]> {
    const rows = await this.driver.getAll<SubtaskRow>(
      'SELECT id, task_id, title, done, position, due_at, created_at FROM subtasks WHERE task_id = ? ORDER BY position, created_at',
      [taskId]
    );
    return rows.map(mapSubtask);
  }

  async create(taskId: ID, title: string, now: number = Date.now(), dueAt: number | null = null): Promise<Subtask> {
    const pos = await this.driver.getFirst<{ n: number }>(
      'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM subtasks WHERE task_id = ?',
      [taskId]
    );
    const subtask: Subtask = {
      id: newId(),
      taskId,
      title: title.trim(),
      done: false,
      position: pos?.n ?? 0,
      dueAt,
      createdAt: now,
    };
    await this.driver.run(
      'INSERT INTO subtasks (id, task_id, title, done, position, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [subtask.id, subtask.taskId, subtask.title, toInt(subtask.done), subtask.position, subtask.dueAt, subtask.createdAt]
    );
    return subtask;
  }

  async toggle(id: ID, now: number = Date.now()): Promise<Subtask | null> {
    const row = await this.driver.getFirst<SubtaskRow>(
      'SELECT id, task_id, title, done, position, due_at, created_at FROM subtasks WHERE id = ?',
      [id]
    );
    if (!row) return null;
    const done = row.done === 1 ? 0 : 1;
    await this.driver.run('UPDATE subtasks SET done = ? WHERE id = ?', [done, id]);
    void now;
    return { ...mapSubtask(row), done: done === 1 };
  }

  async updateTitle(id: ID, title: string): Promise<boolean> {
    const res = await this.driver.run('UPDATE subtasks SET title = ? WHERE id = ?', [title.trim(), id]);
    return res.changes > 0;
  }

  async setDueAt(id: ID, dueAt: number | null): Promise<boolean> {
    const res = await this.driver.run('UPDATE subtasks SET due_at = ? WHERE id = ?', [dueAt, id]);
    return res.changes > 0;
  }

  /** Ближайший невыполненный этап с датой (для карточки задачи и сводки). */
  async nextDue(taskId: ID): Promise<Subtask | null> {
    const row = await this.driver.getFirst<SubtaskRow>(
      `SELECT id, task_id, title, done, position, due_at, created_at FROM subtasks
       WHERE task_id = ? AND done = 0 AND due_at IS NOT NULL ORDER BY due_at LIMIT 1`,
      [taskId]
    );
    return row ? mapSubtask(row) : null;
  }

  /**
   * Невыполненные этапы активных задач со сроком в интервале. Этап, совпадающий
   * с дедлайном самой задачи (защита/сдача), не возвращается — он и так виден как дедлайн.
   */
  async listDueBetween(from: number, to: number): Promise<Array<Subtask & { taskTitle: string }>> {
    const rows = await this.driver.getAll<SubtaskRow & { task_title: string }>(
      `SELECT st.id, st.task_id, st.title, st.done, st.position, st.due_at, st.created_at, t.title AS task_title
       FROM subtasks st JOIN tasks t ON t.id = st.task_id
       WHERE st.done = 0 AND st.due_at IS NOT NULL AND st.due_at >= ? AND st.due_at < ?
         AND t.status != 'done' AND (t.deadline_at IS NULL OR st.due_at != t.deadline_at)
       ORDER BY st.due_at`,
      [from, to]
    );
    return rows.map((r) => ({ ...mapSubtask(r), taskTitle: r.task_title }));
  }

  async delete(id: ID): Promise<boolean> {
    const res = await this.driver.run('DELETE FROM subtasks WHERE id = ?', [id]);
    return res.changes > 0;
  }

  /** Прогресс подзадач: [выполнено, всего]. */
  async progress(taskId: ID): Promise<{ done: number; total: number }> {
    const row = await this.driver.getFirst<{ done: number; total: number }>(
      'SELECT COALESCE(SUM(done), 0) AS done, COUNT(*) AS total FROM subtasks WHERE task_id = ?',
      [taskId]
    );
    return { done: row?.done ?? 0, total: row?.total ?? 0 };
  }
}
