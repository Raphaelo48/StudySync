import { newId } from '../../core/id';
import { endOfDay, startOfDay } from '../../core/time';
import type { ID, Task, TaskPriority, TaskStatus, TaskWithSubject } from '../../models/types';
import type { SqlDriver } from '../driver';
import { mapTask, mapTaskWithSubject, type TaskRow } from '../mappers';

export interface TaskInput {
  source?: import('../../models/types').TaskSource;
  sourceRef?: string | null;
  title: string;
  description?: string | null;
  subjectId?: ID | null;
  deadlineAt?: number | null;
  plannedMinutes?: number;
  difficulty?: 1 | 2 | 3;
  priority?: TaskPriority;
  status?: TaskStatus;
}

export type TaskSort = 'deadline' | 'priority' | 'created' | 'title' | 'duration';

export interface TaskFilter {
  status?: TaskStatus | 'active' | 'all';
  subjectId?: ID | null;
  due?: 'today' | 'week' | 'overdue' | 'nodate';
  search?: string;
  sort?: TaskSort;
  sortDir?: 'asc' | 'desc';
}

const BASE_SELECT = `
  SELECT t.id, t.source, t.source_ref, t.title, t.description, t.subject_id, t.deadline_at, t.planned_minutes,
         t.difficulty, t.priority, t.status, t.created_at, t.updated_at, t.completed_at,
         t.actual_minutes, t.defer_count, t.scheduled_start_at, t.scheduled_end_at,
         s.name AS subject_name, s.color AS subject_color
  FROM tasks t LEFT JOIN subjects s ON s.id = t.subject_id`;

function sortClause(sort: TaskSort, dir: 'asc' | 'desc'): string {
  const d = dir === 'desc' ? 'DESC' : 'ASC';
  switch (sort) {
    case 'deadline':
      // Задачи без срока — всегда в конце при сортировке по дедлайну.
      return `t.deadline_at IS NULL, t.deadline_at ${d}`;
    case 'priority':
      return `t.priority ${d}, t.deadline_at IS NULL, t.deadline_at ASC`;
    case 'created':
      return `t.created_at ${d}`;
    case 'title':
      return `t.title COLLATE NOCASE ${d}`;
    case 'duration':
      return `t.planned_minutes ${d}`;
  }
}

export class TasksRepo {
  constructor(private readonly driver: SqlDriver) {}

  async list(filter: TaskFilter = {}, now: number = Date.now()): Promise<TaskWithSubject[]> {
    const where: string[] = [];
    const params: (string | number | null)[] = [];

    const status = filter.status ?? 'active';
    if (status === 'active') {
      where.push(`t.status <> 'done'`);
    } else if (status !== 'all') {
      where.push('t.status = ?');
      params.push(status);
    }
    if (filter.subjectId !== undefined) {
      if (filter.subjectId === null) {
        where.push('t.subject_id IS NULL');
      } else {
        where.push('t.subject_id = ?');
        params.push(filter.subjectId);
      }
    }
    if (filter.due === 'today') {
      where.push('t.deadline_at IS NOT NULL AND t.deadline_at BETWEEN ? AND ?');
      params.push(startOfDay(now), endOfDay(now));
    } else if (filter.due === 'week') {
      where.push('t.deadline_at IS NOT NULL AND t.deadline_at BETWEEN ? AND ?');
      params.push(now, startOfDay(now) + 7 * 86_400_000);
    } else if (filter.due === 'overdue') {
      where.push("t.deadline_at IS NOT NULL AND t.deadline_at < ? AND t.status <> 'done'");
      params.push(now);
    } else if (filter.due === 'nodate') {
      where.push('t.deadline_at IS NULL');
    }
    if (filter.search && filter.search.trim().length > 0) {
      where.push('(t.title LIKE ? OR COALESCE(t.description, \'\') LIKE ?)');
      const like = `%${filter.search.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
      params.push(like, like);
    }

    const sql = `${BASE_SELECT}${where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${sortClause(filter.sort ?? 'deadline', filter.sortDir ?? 'asc')}`;
    const rows = await this.driver.getAll<TaskRow>(sql, params);
    return rows.map(mapTaskWithSubject);
  }

  async get(id: ID): Promise<TaskWithSubject | null> {
    const row = await this.driver.getFirst<TaskRow>(`${BASE_SELECT} WHERE t.id = ?`, [id]);
    return row ? mapTaskWithSubject(row) : null;
  }

  async create(input: TaskInput, now: number = Date.now()): Promise<Task> {
    const task: Task = {
      id: newId(),
      source: input.source ?? 'manual',
      sourceRef: input.sourceRef ?? null,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      subjectId: input.subjectId ?? null,
      deadlineAt: input.deadlineAt ?? null,
      plannedMinutes: input.plannedMinutes ?? 30,
      difficulty: input.difficulty ?? 2,
      priority: input.priority ?? 2,
      status: input.status ?? 'planned',
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      actualMinutes: 0,
      deferCount: 0,
      scheduledStartAt: null,
      scheduledEndAt: null,
    };
    await this.driver.run(
      `INSERT INTO tasks (id, source, source_ref, title, description, subject_id, deadline_at, planned_minutes, difficulty,
        priority, status, created_at, updated_at, completed_at, actual_minutes, defer_count,
        scheduled_start_at, scheduled_end_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        task.id, task.source, task.sourceRef, task.title, task.description, task.subjectId, task.deadlineAt, task.plannedMinutes,
        task.difficulty, task.priority, task.status, task.createdAt, task.updatedAt,
        task.completedAt, task.actualMinutes, task.deferCount, task.scheduledStartAt, task.scheduledEndAt,
      ]
    );
    return task;
  }

  async update(id: ID, patch: Partial<TaskInput> & {
    completedAt?: number | null;
    actualMinutes?: number;
    scheduledStartAt?: number | null;
    scheduledEndAt?: number | null;
  }, now: number = Date.now()): Promise<Task | null> {
    const current = await this.driver.getFirst<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id]);
    if (!current) return null;
    const next: Task = {
      ...mapTask(current),
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description?.trim() || null } : {}),
      ...(patch.subjectId !== undefined ? { subjectId: patch.subjectId } : {}),
      ...(patch.deadlineAt !== undefined ? { deadlineAt: patch.deadlineAt } : {}),
      ...(patch.plannedMinutes !== undefined ? { plannedMinutes: patch.plannedMinutes } : {}),
      ...(patch.difficulty !== undefined ? { difficulty: patch.difficulty } : {}),
      ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
      ...(patch.actualMinutes !== undefined ? { actualMinutes: patch.actualMinutes } : {}),
      ...(patch.scheduledStartAt !== undefined ? { scheduledStartAt: patch.scheduledStartAt } : {}),
      ...(patch.scheduledEndAt !== undefined ? { scheduledEndAt: patch.scheduledEndAt } : {}),
      updatedAt: now,
    };
    await this.driver.run(
      `UPDATE tasks SET title = ?, description = ?, subject_id = ?, deadline_at = ?, planned_minutes = ?,
        difficulty = ?, priority = ?, status = ?, completed_at = ?, actual_minutes = ?,
        scheduled_start_at = ?, scheduled_end_at = ?, updated_at = ?
       WHERE id = ?`,
      [
        next.title, next.description, next.subjectId, next.deadlineAt, next.plannedMinutes,
        next.difficulty, next.priority, next.status, next.completedAt, next.actualMinutes,
        next.scheduledStartAt, next.scheduledEndAt, next.updatedAt, id,
      ]
    );
    return next;
  }

  /**
   * Перевести задачу в статус. При 'done' фиксирует completed_at и прибавляет
   * фактические минуты (если переданы). При возврате из 'done' снимает completed_at.
   */
  async setStatus(
    id: ID,
    status: TaskStatus,
    opts: { addActualMinutes?: number; now?: number } = {}
  ): Promise<Task | null> {
    const now = opts.now ?? Date.now();
    const current = await this.driver.getFirst<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id]);
    if (!current) return null;
    const completedAt = status === 'done' ? (current.completed_at ?? now) : null;
    const actualMinutes = Math.max(
      0,
      current.actual_minutes + (status === 'done' ? (opts.addActualMinutes ?? 0) : 0)
    );
    await this.driver.run(
      'UPDATE tasks SET status = ?, completed_at = ?, actual_minutes = ?, updated_at = ? WHERE id = ?',
      [status, completedAt, actualMinutes, now, id]
    );
    return { ...mapTask(current), status, completedAt, actualMinutes, updatedAt: now };
  }

  /** Отметить выполненной / снять отметку (обратимое действие). */
  async toggleDone(id: ID, now: number = Date.now()): Promise<Task | null> {
    const current = await this.driver.getFirst<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id]);
    if (!current) return null;
    if (current.status !== 'done') return this.setStatus(id, 'done', { now });
    // Снятие отметки: если по задаче уже работали, она «в работе», а не «запланирована».
    const back: TaskStatus = (current.actual_minutes ?? 0) > 0 ? 'in_progress' : 'planned';
    return this.setStatus(id, back, { now });
  }

  /** Перенести дедлайн; учитывает счётчик переносов для аналитики. */
  async defer(id: ID, newDeadlineAt: number | null, now: number = Date.now()): Promise<Task | null> {
    const current = await this.driver.getFirst<TaskRow>('SELECT * FROM tasks WHERE id = ?', [id]);
    if (!current) return null;
    await this.driver.run(
      `UPDATE tasks SET deadline_at = ?, defer_count = defer_count + 1, updated_at = ?,
        status = CASE WHEN status = 'done' OR ? IS NULL THEN status ELSE 'deferred' END
       WHERE id = ?`,
      [newDeadlineAt, now, newDeadlineAt, id]
    );
    return this.get(id);
  }

  async delete(id: ID): Promise<boolean> {
    const res = await this.driver.run('DELETE FROM tasks WHERE id = ?', [id]);
    return res.changes > 0;
  }

  /** Задачи источника с префиксом source_ref (синхронизация импорта). */
  async listBySourceRefPrefix(source: 'manual' | 'moodle', refPrefix: string): Promise<Task[]> {
    const rows = await this.driver.getAll<TaskRow>(
      `SELECT * FROM tasks WHERE source = ? AND source_ref LIKE ? ORDER BY deadline_at IS NULL, deadline_at`,
      [source, `${refPrefix}%`]
    );
    return rows.map(mapTask);
  }

  /** Просроченные активные задачи. */
  async listOverdue(now: number = Date.now()): Promise<TaskWithSubject[]> {
    return this.list({ status: 'active', due: 'overdue', sort: 'deadline' }, now);
  }

  /** Задачи на сегодня (дедлайн сегодня или запланированы на сегодня). */
  async listDueOnDay(dayTs: number, now: number = Date.now()): Promise<TaskWithSubject[]> {
    const rows = await this.driver.getAll<TaskRow>(
      `${BASE_SELECT}
       WHERE t.status <> 'done'
         AND (
           (t.deadline_at IS NOT NULL AND t.deadline_at BETWEEN ? AND ?)
           OR (t.scheduled_start_at IS NOT NULL AND t.scheduled_start_at BETWEEN ? AND ?)
         )
       ORDER BY t.deadline_at IS NULL, t.deadline_at ASC, t.priority DESC`,
      [startOfDay(dayTs), endOfDay(dayTs), startOfDay(dayTs), endOfDay(dayTs)]
    );
    void now;
    return rows.map(mapTaskWithSubject);
  }

  /** Все активные задачи (для перепланировщика). */
  async listActive(): Promise<Task[]> {
    const rows = await this.driver.getAll<TaskRow>(
      `SELECT * FROM tasks WHERE status <> 'done' ORDER BY deadline_at IS NULL, deadline_at ASC`
    );
    return rows.map(mapTask);
  }

  /** Прибавить фактическое время (минуты, можно дробные → округляем вверх до целой минуты). */
  async addActualMinutes(id: ID, minutes: number, now: number = Date.now()): Promise<void> {
    const delta = Math.max(0, Math.round(minutes));
    if (delta === 0) return;
    await this.driver.run(
      'UPDATE tasks SET actual_minutes = actual_minutes + ?, updated_at = ? WHERE id = ?',
      [delta, now, id]
    );
  }
}
