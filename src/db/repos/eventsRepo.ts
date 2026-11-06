import { newId } from '../../core/id';
import { DAY_MS } from '../../core/time';
import type {
  CalendarEvent,
  EventKind,
  EventSource,
  EventWithRelations,
  ID,
  RecurrenceRule,
  Subject,
  TaskStatus,
} from '../../models/types';
import type { SqlDriver } from '../driver';
import { mapEvent, type EventRow } from '../mappers';

export interface EventInput {
  title: string;
  kind?: EventKind;
  subjectId?: ID | null;
  taskId?: ID | null;
  location?: string | null;
  startAt: number;
  endAt: number;
  notes?: string | null;
  seriesId?: ID | null;
  recurrence?: RecurrenceRule | null;
  notifyOffsetMinutes?: number | null;
  source?: import('../../models/types').EventSource;
  sourceRef?: string | null;
}

const BASE_SELECT = `
  SELECT e.id, e.title, e.kind, e.subject_id, e.task_id, e.location, e.start_at, e.end_at,
         e.notes, e.series_id, e.recurrence_json, e.notify_offset_minutes, e.source, e.source_ref,
         e.created_at, e.updated_at,
         s.name AS subject_name, s.color AS subject_color,
         t.title AS task_title, t.status AS task_status
  FROM events e
  LEFT JOIN subjects s ON s.id = e.subject_id
  LEFT JOIN tasks t ON t.id = e.task_id`;

export class EventsRepo {
  constructor(private readonly driver: SqlDriver) {}

  /** События в полуинтервале [from, to). */
  async listRange(from: number, to: number): Promise<EventWithRelations[]> {
    const rows = await this.driver.getAll<EventRow>(
      `${BASE_SELECT} WHERE e.start_at < ? AND e.end_at > ? ORDER BY e.start_at`,
      [to, from]
    );
    return rows.map((r) => ({
      ...mapEvent(r),
      subject:
        r.subject_id && r.subject_name
          ? ({ id: r.subject_id, name: r.subject_name, color: r.subject_color ?? '#7C6CF0' } as Pick<
              Subject,
              'id' | 'name' | 'color'
            >)
          : null,
      task:
        r.task_id && r.task_title
          ? { id: r.task_id, title: r.task_title, status: (r.task_status ?? 'planned') as TaskStatus }
          : null,
    }));
  }

  async listDay(dayStart: number): Promise<EventWithRelations[]> {
    return this.listRange(dayStart, dayStart + DAY_MS);
  }

  async get(id: ID): Promise<CalendarEvent | null> {
    const row = await this.driver.getFirst<EventRow>(
      `SELECT id, title, kind, subject_id, task_id, location, start_at, end_at, notes,
              series_id, recurrence_json, notify_offset_minutes, source, source_ref, created_at, updated_at
       FROM events WHERE id = ?`,
      [id]
    );
    return row ? mapEvent(row) : null;
  }

  async create(input: EventInput, now: number = Date.now()): Promise<CalendarEvent> {
    const event: CalendarEvent = {
      id: newId(),
      title: input.title.trim(),
      kind: input.kind ?? 'lesson',
      subjectId: input.subjectId ?? null,
      taskId: input.taskId ?? null,
      location: input.location?.trim() || null,
      startAt: input.startAt,
      endAt: input.endAt,
      notes: input.notes?.trim() || null,
      seriesId: input.seriesId ?? null,
      recurrence: input.recurrence ?? null,
      notifyOffsetMinutes: input.notifyOffsetMinutes ?? null,
      source: input.source ?? 'manual',
      sourceRef: input.sourceRef ?? null,
      createdAt: now,
      updatedAt: now,
    };
    await this.driver.run(
      `INSERT INTO events (id, title, kind, subject_id, task_id, location, start_at, end_at, notes,
        series_id, recurrence_json, notify_offset_minutes, source, source_ref, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.id, event.title, event.kind, event.subjectId, event.taskId, event.location,
        event.startAt, event.endAt, event.notes, event.seriesId,
        event.recurrence ? JSON.stringify(event.recurrence) : null,
        event.notifyOffsetMinutes, event.source, event.sourceRef, event.createdAt, event.updatedAt,
      ]
    );
    return event;
  }

  async update(id: ID, patch: Partial<EventInput>, now: number = Date.now()): Promise<CalendarEvent | null> {
    const current = await this.get(id);
    if (!current) return null;
    const next: CalendarEvent = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.subjectId !== undefined ? { subjectId: patch.subjectId } : {}),
      ...(patch.taskId !== undefined ? { taskId: patch.taskId } : {}),
      ...(patch.location !== undefined ? { location: patch.location?.trim() || null } : {}),
      ...(patch.startAt !== undefined ? { startAt: patch.startAt } : {}),
      ...(patch.endAt !== undefined ? { endAt: patch.endAt } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
      ...(patch.seriesId !== undefined ? { seriesId: patch.seriesId } : {}),
      ...(patch.recurrence !== undefined ? { recurrence: patch.recurrence } : {}),
      ...(patch.notifyOffsetMinutes !== undefined ? { notifyOffsetMinutes: patch.notifyOffsetMinutes } : {}),
      ...(patch.source !== undefined ? { source: patch.source } : {}),
      ...(patch.sourceRef !== undefined ? { sourceRef: patch.sourceRef } : {}),
      updatedAt: now,
    };
    await this.driver.run(
      `UPDATE events SET title = ?, kind = ?, subject_id = ?, task_id = ?, location = ?, start_at = ?,
        end_at = ?, notes = ?, series_id = ?, recurrence_json = ?, notify_offset_minutes = ?,
        source = ?, source_ref = ?, updated_at = ?
       WHERE id = ?`,
      [
        next.title, next.kind, next.subjectId, next.taskId, next.location, next.startAt, next.endAt,
        next.notes, next.seriesId,
        next.recurrence ? JSON.stringify(next.recurrence) : null,
        next.notifyOffsetMinutes, next.source, next.sourceRef, next.updatedAt, id,
      ]
    );
    return next;
  }

  async delete(id: ID): Promise<boolean> {
    const res = await this.driver.run('DELETE FROM events WHERE id = ?', [id]);
    return res.changes > 0;
  }

  async deleteSeries(seriesId: ID, fromTs?: number): Promise<number> {
    if (fromTs !== undefined) {
      const res = await this.driver.run(
        'DELETE FROM events WHERE series_id = ? AND start_at >= ?',
        [seriesId, fromTs]
      );
      return res.changes;
    }
    const res = await this.driver.run('DELETE FROM events WHERE series_id = ?', [seriesId]);
    return res.changes;
  }

  async listSeries(seriesId: ID): Promise<CalendarEvent[]> {
    const rows = await this.driver.getAll<EventRow>(
      `SELECT id, title, kind, subject_id, task_id, location, start_at, end_at, notes,
              series_id, recurrence_json, notify_offset_minutes, source, source_ref, created_at, updated_at
       FROM events WHERE series_id = ? ORDER BY start_at`,
      [seriesId]
    );
    return rows.map(mapEvent);
  }

  /** Конфликты: события, пересекающиеся с интервалом [startAt, endAt), кроме ignoreId. */
  async findConflicts(startAt: number, endAt: number, ignoreId: ID | null = null): Promise<CalendarEvent[]> {
    const rows = await this.driver.getAll<EventRow>(
      `SELECT id, title, kind, subject_id, task_id, location, start_at, end_at, notes,
              series_id, recurrence_json, notify_offset_minutes, source, source_ref, created_at, updated_at
       FROM events
       WHERE start_at < ? AND end_at > ? ${ignoreId ? 'AND id <> ?' : ''}
       ORDER BY start_at`,
      ignoreId ? [endAt, startAt, ignoreId] : [endAt, startAt]
    );
    return rows.map(mapEvent);
  }

  /** Учебные блоки (kind='study'), созданные для задачи. */
  async listStudyBlocksForTask(taskId: ID): Promise<CalendarEvent[]> {
    const rows = await this.driver.getAll<EventRow>(
      `SELECT id, title, kind, subject_id, task_id, location, start_at, end_at, notes,
              series_id, recurrence_json, notify_offset_minutes, source, source_ref, created_at, updated_at
       FROM events WHERE task_id = ? AND kind = 'study' ORDER BY start_at`,
      [taskId]
    );
    return rows.map(mapEvent);
  }

  async deleteMany(ids: ID[]): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => '?').join(', ');
    const res = await this.driver.run(`DELETE FROM events WHERE id IN (${placeholders})`, ids);
    return res.changes;
  }

  /** Импортированные события источника с префиксом source_ref (для синхронизации). */
  async listBySourceRefPrefix(source: EventSource, refPrefix: string): Promise<CalendarEvent[]> {
    const rows = await this.driver.getAll<EventRow>(
      `SELECT id, title, kind, subject_id, task_id, location, start_at, end_at, notes,
              series_id, recurrence_json, notify_offset_minutes, source, source_ref, created_at, updated_at
       FROM events WHERE source = ? AND source_ref LIKE ? ORDER BY start_at`,
      [source, `${refPrefix}%`]
    );
    return rows.map(mapEvent);
  }

  /** Будущие события (для планировщика уведомлений). */
  async listUpcoming(afterTs: number, limit = 200): Promise<CalendarEvent[]> {
    const rows = await this.driver.getAll<EventRow>(
      `SELECT id, title, kind, subject_id, task_id, location, start_at, end_at, notes,
              series_id, recurrence_json, notify_offset_minutes, source, source_ref, created_at, updated_at
       FROM events WHERE end_at > ? ORDER BY start_at LIMIT ?`,
      [afterTs, limit]
    );
    return rows.map(mapEvent);
  }
}
